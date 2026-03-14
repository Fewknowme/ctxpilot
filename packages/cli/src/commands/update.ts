import { Command } from "commander";
import { simpleGit } from "simple-git";

import { getEnv, getProviderResolution } from "../config/env.js";
import { extractSignalsFromChanges, mergeSignalsIntoLcd } from "../core/builder.js";
import { compressLcd, enforceTokenBudget } from "../core/compressor.js";
import {
  ensureCkStructure,
  markSignalsProcessed,
  readCkConfig,
  readLcd,
  readSignals,
  writeCkConfig,
  writeLcd
} from "../core/lcd.js";

export interface UpdateCommandOptions {
  since?: string;
}

const DEFAULT_SINCE_FALLBACK_MS = 24 * 60 * 60 * 1000;
const HUMAN_TIMEFRAME_PATTERN = /^(\d+)([hdw])$/i;

const parseSinceInput = (value: string): Date => {
  const trimmed = value.trim();
  const match = HUMAN_TIMEFRAME_PATTERN.exec(trimmed);
  if (match) {
    const amount = Number.parseInt(match[1] ?? "0", 10);
    const unit = (match[2] ?? "").toLowerCase();
    const unitToMilliseconds: Record<string, number> = {
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
      w: 7 * 24 * 60 * 60 * 1000
    };
    const duration = unitToMilliseconds[unit];
    if (!duration) {
      throw new Error(`Unsupported --since unit: ${unit}`);
    }

    return new Date(Date.now() - amount * duration);
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("Invalid --since value. Use 1h, 2d, 1w, or an ISO date.");
  }

  return parsed;
};

const resolveSinceDate = (since: string | undefined, lastUpdated: string | null): Date => {
  if (since && since.trim().length > 0) {
    return parseSinceInput(since);
  }

  if (lastUpdated && lastUpdated.trim().length > 0) {
    return parseSinceInput(lastUpdated);
  }

  // Simplest bounded fallback when metadata is missing: inspect the last 24 hours.
  return new Date(Date.now() - DEFAULT_SINCE_FALLBACK_MS);
};

const formatGitSinceRef = (date: Date): string => `HEAD@{${date.toISOString()}}`;

const parseModifiedFiles = (content: string): string[] =>
  content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const dedupe = (values: string[]): string[] => Array.from(new Set(values));

const readGitLogSince = async (
  git: ReturnType<typeof simpleGit>,
  sinceDate: Date
) => {
  return git.log({
    maxCount: 30,
    "--after": sinceDate.toISOString()
  });
};

const readCommittedDiffSince = async (
  git: ReturnType<typeof simpleGit>,
  sinceDate: Date,
  oldestCommitHash: string | undefined,
  nameOnly = false
): Promise<string> => {
  const modeArgs = nameOnly ? ["--name-only"] : [];
  try {
    return await git.raw(["diff", ...modeArgs, formatGitSinceRef(sinceDate), "HEAD"]);
  } catch {
    if (typeof oldestCommitHash === "string" && oldestCommitHash.trim().length > 0) {
      return git.raw(["diff", ...modeArgs, oldestCommitHash, "HEAD"]);
    }

    return "";
  }
};

export const runUpdate = async (options: UpdateCommandOptions = {}): Promise<void> => {
  const root = process.cwd();
  await ensureCkStructure(root);

  const env = getEnv();
  const providerResolution = getProviderResolution();
  const config = await readCkConfig(root);
  const activeModel =
    env.CK_MODEL ??
    (config.provider === providerResolution.provider ? config.aiModel : undefined);
  const sinceDate = resolveSinceDate(options.since, config.lastUpdated);
  const signals = await readSignals(root);
  const unprocessedSignals = signals.filter((item) => item.processedAt === null);

  const git = simpleGit({ baseDir: root });
  const gitLog = await readGitLogSince(git, sinceDate);
  const oldestCommitHash = gitLog.all[gitLog.all.length - 1]?.hash;
  const committedDiff = await readCommittedDiffSince(git, sinceDate, oldestCommitHash);
  const workingTreeDiff = await git.diff();
  const gitDiff = [committedDiff, workingTreeDiff].filter((chunk) => chunk.trim().length > 0).join("\n\n");
  const committedFiles = parseModifiedFiles(
    await readCommittedDiffSince(git, sinceDate, oldestCommitHash, true)
  );
  const status = await git.status();
  const modifiedFiles = dedupe([...committedFiles, ...status.files.map((file) => file.path)]);

  const lcd = await readLcd(root);
  if (!lcd.exists) {
    throw new Error("No LCD found. Run `ctx init` first.");
  }

  if (
    gitDiff.trim().length === 0 &&
    status.files.length === 0 &&
    unprocessedSignals.length === 0 &&
    gitLog.total === 0
  ) {
    process.stdout.write("No new changes to process.\n");
    return;
  }

  const extractionRequest = {
    projectRoot: root,
    gitDiff,
    newCommits: gitLog.all
      .map((entry) => `${entry.hash.slice(0, 7)} ${entry.date} ${entry.message}`)
      .join("\n"),
    modifiedFiles,
    manualSignals: unprocessedSignals.map((signal) => signal.text)
  };
  const extracted = await extractSignalsFromChanges(
    typeof activeModel === "string"
      ? {
          ...extractionRequest,
          model: activeModel
        }
      : extractionRequest
  );

  const merged = await mergeSignalsIntoLcd(
    typeof activeModel === "string"
      ? {
          currentLcd: lcd.content,
          signals: extracted,
          tokenBudget: env.CK_TOKEN_BUDGET ?? config.tokenBudget,
          model: activeModel
        }
      : {
          currentLcd: lcd.content,
          signals: extracted,
          tokenBudget: env.CK_TOKEN_BUDGET ?? config.tokenBudget
        }
  );
  const compressionRequest = {
    projectRoot: root,
    currentLcd: merged,
    tokenBudget: env.CK_TOKEN_BUDGET ?? config.tokenBudget
  };
  const compression = await compressLcd(
    typeof activeModel === "string"
      ? {
          ...compressionRequest,
          model: activeModel
        }
      : compressionRequest
  );

  await writeLcd({
    projectRoot: root,
    content: compression.compressedLcd,
    archiveNote: "Incremental context update"
  });

  if (unprocessedSignals.length > 0) {
    await markSignalsProcessed(
      unprocessedSignals.map((signal) => signal.id),
      root
    );
  }

  await writeCkConfig(
    {
      version: config.version + 1,
      lastUpdated: new Date().toISOString(),
      lastTokenCount: compression.afterTokens
    },
    root
  );

  const before = enforceTokenBudget(lcd.content, config.tokenBudget);
  process.stdout.write(
    `Updated LCD. Tokens ${before.tokens} -> ${compression.afterTokens}. Version ${config.version + 1}.\n`
  );
};

export const registerUpdateCommand = (program: Command): void => {
  program
    .command("update")
    .description("Incrementally update the Living Context Document")
    .option("--since <timeframe>", "Update from a specific timeframe (e.g. 2h, 1d, ISO date)")
    .action(async (options: UpdateCommandOptions) => {
      await runUpdate(options);
    });
};
