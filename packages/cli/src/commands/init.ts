import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import { createInterface } from "node:readline/promises";

import { Command } from "commander";
import { simpleGit } from "simple-git";

import { resolveModel, runClaudeText } from "../ai/client.js";
import {
  formatProviderSource,
  getProviderResolution,
  type AiProvider,
  type ProviderResolution
} from "../config/env.js";
import { renderInitPrompt } from "../ai/prompts/init.js";
import {
  ensureCkStructure,
  getDefaultCkConfig,
  readCkConfig,
  readLcd,
  writeCkConfig,
  writeLcd
} from "../core/lcd.js";
import { getMcpConfigSnippets } from "../core/mcp.js";

const MAX_TREE_ENTRIES = 500;
const MAX_KEY_FILE_BYTES = 10_000;
const DEFAULT_MODELS_BY_PROVIDER: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini"
};

const listTree = async (root: string): Promise<string[]> => {
  const entries: string[] = [];
  const ignore = new Set([".git", "node_modules", "dist", ".ctxpilot"]);

  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > 4 || entries.length >= MAX_TREE_ENTRIES) {
      return;
    }

    const children = await readdir(current, { withFileTypes: true });
    for (const child of children) {
      if (ignore.has(child.name)) {
        continue;
      }

      const absolute = path.join(current, child.name);
      const relative = path.relative(root, absolute) || ".";
      entries.push(relative);
      if (entries.length >= MAX_TREE_ENTRIES) {
        return;
      }
      if (child.isDirectory()) {
        await walk(absolute, depth + 1);
      }
    }
  };

  await walk(root, 0);
  return entries;
};

const readIfExists = async (filePath: string): Promise<string> => {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return "";
  }
};

const getGitLog = async (cwd: string): Promise<string> => {
  try {
    const git = simpleGit({ baseDir: cwd });
    const log = await git.log({ maxCount: 30 });
    return log.all
      .map(
        (entry) => `${entry.hash.slice(0, 7)} ${entry.date} ${entry.message}`,
      )
      .join("\n");
  } catch {
    return "";
  }
};

const getKeyFilesContent = async (
  root: string,
  tree: string[],
): Promise<string> => {
  const candidateFiles = tree.filter((file) => {
    if (
      file.endsWith(".ts") ||
      file.endsWith(".tsx") ||
      file.endsWith(".js") ||
      file.endsWith(".md")
    ) {
      return true;
    }
    return file === "package.json";
  });

  const keyFiles = candidateFiles.slice(0, 10);
  const chunks: string[] = [];

  for (const relativePath of keyFiles) {
    const absolutePath = path.join(root, relativePath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile() || fileStat.size > MAX_KEY_FILE_BYTES) {
        continue;
      }
      const content = await readFile(absolutePath, "utf8");
      chunks.push(
        `### ${relativePath}\n${content.slice(0, MAX_KEY_FILE_BYTES)}`,
      );
    } catch {
      continue;
    }
  }

  return chunks.join("\n\n");
};

const askInitQuestions = async (): Promise<{
  provider: AiProvider;
  providerPrompted: boolean;
  goal: string;
  stackConfirmation: string;
  preferences: string;
}> => {
  const providerResolution = getProviderResolution();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const providerResult =
      providerResolution.source === "default"
        ? await askProviderQuestion(rl, providerResolution)
        : {
            provider: providerResolution.provider,
            providerPrompted: false
          };
    const goal = await rl.question("What is your current project goal? ");
    const stackConfirmation = await rl.question(
      "Confirm your stack in one line: ",
    );
    const preferences = await rl.question(
      "Any coding preferences I should lock in? ",
    );
    return {
      provider: providerResult.provider,
      providerPrompted: providerResult.providerPrompted,
      goal: goal.trim(),
      stackConfirmation: stackConfirmation.trim(),
      preferences: preferences.trim(),
    };
  } finally {
    rl.close();
  }
};

const askProviderQuestion = async (
  rl: ReturnType<typeof createInterface>,
  providerResolution: ProviderResolution
): Promise<{ provider: AiProvider; providerPrompted: boolean }> => {
  const providerAnswer = await rl.question(
    `Which AI provider? (anthropic/openai) [${providerResolution.provider}]: `
  );

  return {
    provider: normalizeProviderInput(providerAnswer, providerResolution.provider),
    providerPrompted: true
  };
};

const normalizeProviderInput = (value: string, fallback: AiProvider): AiProvider => {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }

  if (normalized === "anthropic") {
    return "anthropic";
  }

  if (normalized === "openai") {
    return "openai";
  }

  throw new Error('Invalid provider. Expected "anthropic" or "openai".');
};

const getAiFailureMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null) {
    const nestedError = Reflect.get(error, "error");
    if (typeof nestedError === "object" && nestedError !== null) {
      const nestedMessage = Reflect.get(nestedError, "message");
      if (typeof nestedMessage === "string" && nestedMessage.trim().length > 0) {
        return nestedMessage.trim();
      }
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return String(error);
};

const buildFallbackLcd = (answers: {
  provider: AiProvider;
  goal: string;
  stackConfirmation: string;
  preferences: string;
}): string => `# Project Context
> Last updated: ${new Date().toISOString()} | Version: 1 | Tokens: ~0

## 🧭 Project Identity
  - **What it is**: Project initialized with ctxpilot
- **Current phase**: planning
- **Stack**: ${answers.stackConfirmation || "Unknown"}
- **Repo**: local

## 🎯 Active Goal
${answers.goal || "Define and execute the next milestone."}

## ⚙️ Architecture Decisions (Active)
- ctxpilot initialized: baseline context created

## 🚧 In Progress
- Initial setup: running

## ✅ Recently Completed (Last 7 days)
- Bootstrapped ctxpilot

## 🐛 Known Issues / Blockers
- None documented

## 📐 Conventions & Preferences
- Coding style: functional, named exports
- Preferences: ${answers.preferences || "None provided"}

## 🔑 Key Files
- .ctxpilot/context.md: Living Context Document

## 📦 Environment & Setup Notes
- Provider: ${answers.provider}
- Configure the matching API key before AI updates

## 🗂️ Archived Decisions
> Moved to .ctxpilot/archive/ — ask for details if needed
- No archived decisions yet
`;

export const registerInitCommand = (program: Command): void => {
  program
    .command("init")
    .description("Initialize ctxpilot and generate the first LCD")
    .action(async () => {
      const root = process.cwd();
      const hadExistingLcd = (await readLcd(root)).exists;
      await ensureCkStructure(root);

      const tree = await listTree(root);
      const packageJsonContent = await readIfExists(
        path.join(root, "package.json"),
      );
      const readmeContent = await readIfExists(path.join(root, "README.md"));
      const gitLog = await getGitLog(root);
      const keyFiles = await getKeyFilesContent(root, tree);
      const answers = await askInitQuestions();
      if (answers.providerPrompted) {
        process.env.CK_PROVIDER = answers.provider;
      }
      const providerResolution = getProviderResolution();
      const resolvedModel = resolveModel(undefined, providerResolution.provider);
      process.stdout.write(
        `Using provider: ${providerResolution.provider} (${formatProviderSource(providerResolution.source)}), model: ${resolvedModel}\n`
      );

      const prompt = renderInitPrompt({
        fileTree: tree.join("\n"),
        packageJson: packageJsonContent,
        readme: readmeContent || "README not found",
        gitLog,
        keyFiles: `${keyFiles}\n\nUser goal: ${answers.goal}\nStack confirmation: ${answers.stackConfirmation}\nPreferences: ${answers.preferences}`,
      });

      let lcdContent = "";
      try {
        lcdContent = await runClaudeText({
          prompt,
          model: resolvedModel,
          maxTokens: 1800,
          temperature: 0.1
        });
      } catch (error) {
        process.stderr.write(
          `AI context generation failed using ${providerResolution.provider} (${formatProviderSource(providerResolution.source)}) with model ${resolvedModel}. Falling back to the local starter LCD.\n`
        );
        process.stderr.write(`Reason: ${getAiFailureMessage(error)}\n`);
        lcdContent = buildFallbackLcd(answers);
      }

      await writeLcd({
        projectRoot: root,
        content: lcdContent,
        archiveNote: "Initial context generation",
        archiveExisting: hadExistingLcd
      });

      const currentConfig = await readCkConfig(root);
      const nextModel =
        currentConfig.provider === answers.provider ? currentConfig.aiModel : DEFAULT_MODELS_BY_PROVIDER[answers.provider];
      await writeCkConfig(
        {
          ...getDefaultCkConfig(),
          ...currentConfig,
          provider: answers.provider,
          aiModel: nextModel,
          version: 1,
          lastUpdated: new Date().toISOString()
        },
        root
      );

      process.stdout.write("ctxpilot initialized.\n");
      try {
        const snippets = await getMcpConfigSnippets(root);
        process.stdout.write("MCP config snippets:\n");
        process.stdout.write("Claude Code (~/.claude/claude_desktop_config.json)\n");
        process.stdout.write(snippets.claudeCode);
        process.stdout.write("Codex CLI (~/.codex/config.toml)\n");
        process.stdout.write(snippets.codexCli);
        process.stdout.write("Cursor/Windsurf (~/.cursor/mcp.json or ~/.windsurf/mcp.json)\n");
        process.stdout.write(snippets.cursorWindsurf);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Warning: could not generate MCP config snippets. ${message}\n`);
      }
    });
};
