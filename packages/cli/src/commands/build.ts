import { readdir, readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import { Command } from "commander";
import { simpleGit } from "simple-git";

import { resolveModel, runClaudeText } from "../ai/client.js";
import { renderInitPrompt } from "../ai/prompts/init.js";
import { formatProviderSource, getProviderResolution } from "../config/env.js";
import { enforceTokenBudget } from "../core/compressor.js";
import {
  ensureCkStructure,
  getDefaultCkConfig,
  readCkConfig,
  readLcd,
  writeCkConfig,
  writeLcd
} from "../core/lcd.js";

const MAX_TREE_ENTRIES = 500;
const MAX_KEY_FILE_BYTES = 10_000;

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
    return log.all.map((entry) => `${entry.hash.slice(0, 7)} ${entry.date} ${entry.message}`).join("\n");
  } catch {
    return "";
  }
};

const getKeyFilesContent = async (root: string, tree: string[]): Promise<string> => {
  const candidateFiles = tree.filter((file) => {
    if (file.endsWith(".ts") || file.endsWith(".tsx") || file.endsWith(".js") || file.endsWith(".md")) {
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
      chunks.push(`### ${relativePath}\n${content.slice(0, MAX_KEY_FILE_BYTES)}`);
    } catch {
      continue;
    }
  }

  return chunks.join("\n\n");
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

const buildFallbackLcd = (existingLcd: string): string => {
  if (existingLcd.trim().length > 0) {
    return existingLcd;
  }

  return `# Project Context
> Last updated: ${new Date().toISOString()} | Version: 1 | Tokens: ~0

## 🧭 Project Identity
- **What it is**: Project rebuilt with ctxpilot
- **Current phase**: building
- **Stack**: Unknown
- **Repo**: local

## 🎯 Active Goal
Rebuild the Living Context Document from the current repository state.

## ⚙️ Architecture Decisions (Active)
- ctxpilot rebuild completed: baseline context regenerated

## 🚧 In Progress
- Rebuild review: confirm regenerated context

## ✅ Recently Completed (Last 7 days)
- Regenerated LCD from current repository state

## 🐛 Known Issues / Blockers
- None documented

## 📐 Conventions & Preferences
- Preserve existing repository conventions

## 🔑 Key Files
- .ctxpilot/context.md: Living Context Document

## 📦 Environment & Setup Notes
- Configure the matching provider API key before AI updates

## 🗂️ Archived Decisions
> Moved to .ctxpilot/archive/ — ask for details if needed
- No archived decisions yet
`;
};

export const registerBuildCommand = (program: Command): void => {
  program
    .command("build")
    .description("Rebuild the Living Context Document from the current repository state")
    .action(async () => {
      const root = process.cwd();
      await ensureCkStructure(root);

      const currentLcd = await readLcd(root);
      const tree = await listTree(root);
      const packageJsonContent = await readIfExists(path.join(root, "package.json"));
      const readmeContent = await readIfExists(path.join(root, "README.md"));
      const gitLog = await getGitLog(root);
      const keyFiles = await getKeyFilesContent(root, tree);
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
        keyFiles: `${keyFiles}\n\nExisting LCD:\n${currentLcd.content || "None"}\n\nUser goal: Rebuild the Living Context Document from the current repository state.\nStack confirmation: Infer from the repository.\nPreferences: Preserve the project's existing conventions and preferences where supported by the repository state.`
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
        `AI context rebuild failed using ${providerResolution.provider} (${formatProviderSource(providerResolution.source)}) with model ${resolvedModel}. Falling back to the existing LCD.\n`
        );
        process.stderr.write(`Reason: ${getAiFailureMessage(error)}\n`);
        lcdContent = buildFallbackLcd(currentLcd.content);
      }

      await writeLcd({
        projectRoot: root,
        content: lcdContent,
        archiveNote: "Full context rebuild",
        archiveExisting: currentLcd.exists
      });

      const config = await readCkConfig(root);
      const tokenInfo = enforceTokenBudget(lcdContent, config.tokenBudget);
      await writeCkConfig(
        {
          ...getDefaultCkConfig(),
          ...config,
          version: config.version + 1,
          lastUpdated: new Date().toISOString(),
          lastTokenCount: tokenInfo.tokens
        },
        root
      );

      process.stdout.write(
        `ctxpilot rebuild complete. Tokens: ${tokenInfo.tokens}/${config.tokenBudget}. Version ${config.version + 1}.\n`
      );
    });
};
