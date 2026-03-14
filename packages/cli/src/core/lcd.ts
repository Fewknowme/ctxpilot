import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

export interface LcdPaths {
  projectRoot: string;
  ckDir: string;
  contextPath: string;
  configPath: string;
  signalsPath: string;
  archiveDir: string;
  daemonPidPath: string;
}

export interface LcdDocument {
  path: string;
  content: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface ManualSignal {
  id: string;
  text: string;
  createdAt: string;
  processedAt: string | null;
}

export interface CkSectionsConfig {
  projectIdentity: boolean;
  activeGoal: boolean;
  architectureDecisions: boolean;
  inProgress: boolean;
  recentlyCompleted: boolean;
  knownIssues: boolean;
  conventions: boolean;
  keyFiles: boolean;
  environment: boolean;
}

export interface CkTeamConfig {
  enabled: boolean;
  projectId: string | null;
  syncOnUpdate: boolean;
}

export type CkProvider = "anthropic" | "openai";

export interface CkRuntimeConfig {
  provider: CkProvider;
  tokenBudget: number;
  autoWatch: boolean;
  watchTriggers: string[];
  fileIgnore: string[];
  aiModel: string;
  archiveAfterDays: number;
  sections: CkSectionsConfig;
  team: CkTeamConfig;
  version: number;
  lastUpdated: string | null;
  lastTokenCount: number;
}

export interface WriteLcdArgs {
  projectRoot?: string;
  content: string;
  archiveNote?: string;
  archiveExisting?: boolean;
}

export interface ArchiveChunkArgs {
  projectRoot?: string;
  chunk: string;
  note?: string;
}

const DEFAULT_LCD_TEMPLATE = `# Project Context\n> Last updated: never | Version: 1 | Tokens: ~0\n\n## 🧭 Project Identity\n- **What it is**: Unknown\n- **Current phase**: planning\n- **Stack**: Unknown\n- **Repo**: local\n\n## 🎯 Active Goal\nInitialize ctxpilot context.\n\n## ⚙️ Architecture Decisions (Active)\n- ctxpilot initialized: baseline context created\n\n## 🚧 In Progress\n- Initial setup: pending\n\n## ✅ Recently Completed (Last 7 days)\n- Context initialized\n\n## 🐛 Known Issues / Blockers\n- None documented\n\n## 📐 Conventions & Preferences\n- Coding style: functional\n- Naming: named exports\n- Testing: Vitest\n- Avoid: deleting historical context\n\n## 🔑 Key Files\n- .ctxpilot/context.md: Living Context Document\n\n## 📦 Environment & Setup Notes\n- Configure the provider API key in .env before running AI updates\n\n## 🗂️ Archived Decisions\n> Moved to .ctxpilot/archive/ — ask for details if needed\n- No archived decisions yet\n`;

const DEFAULT_MODELS_BY_PROVIDER: Record<CkProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini"
};

const DEFAULT_CONFIG: CkRuntimeConfig = {
  provider: "anthropic",
  tokenBudget: 2000,
  autoWatch: true,
  watchTriggers: ["git-commit", "file-save"],
  fileIgnore: ["node_modules", ".git", "dist", "*.lock"],
  aiModel: DEFAULT_MODELS_BY_PROVIDER.anthropic,
  archiveAfterDays: 7,
  sections: {
    projectIdentity: true,
    activeGoal: true,
    architectureDecisions: true,
    inProgress: true,
    recentlyCompleted: true,
    knownIssues: true,
    conventions: true,
    keyFiles: true,
    environment: false
  },
  team: {
    enabled: false,
    projectId: null,
    syncOnUpdate: false
  },
  version: 1,
  lastUpdated: null,
  lastTokenCount: 0
};

const formatArchiveFileName = (date: Date): string => {
  const year = date.getFullYear().toString();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}.md`;
};

const getNowIso = (): string => new Date().toISOString();

const mergeConfig = (value: unknown): CkRuntimeConfig => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CONFIG };
  }

  const record = value as Partial<CkRuntimeConfig>;
  const provider = record.provider === "openai" ? "openai" : "anthropic";
  return {
    ...DEFAULT_CONFIG,
    ...record,
    provider,
    sections: {
      ...DEFAULT_CONFIG.sections,
      ...(record.sections ?? {})
    },
    team: {
      ...DEFAULT_CONFIG.team,
      ...(record.team ?? {})
    },
    watchTriggers: Array.isArray(record.watchTriggers)
      ? record.watchTriggers
      : [...DEFAULT_CONFIG.watchTriggers],
    fileIgnore: Array.isArray(record.fileIgnore)
      ? record.fileIgnore
      : [...DEFAULT_CONFIG.fileIgnore],
    aiModel:
      typeof record.aiModel === "string" && record.aiModel.trim().length > 0
        ? record.aiModel
        : DEFAULT_MODELS_BY_PROVIDER[provider]
  };
};

const safeParseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const getCkPaths = (projectRoot = process.cwd()): LcdPaths => {
  const normalizedRoot = path.resolve(projectRoot);
  const ckDir = path.join(normalizedRoot, ".ctxpilot");
  return {
    projectRoot: normalizedRoot,
    ckDir,
    contextPath: path.join(ckDir, "context.md"),
    configPath: path.join(ckDir, "config.json"),
    signalsPath: path.join(ckDir, "signals.json"),
    archiveDir: path.join(ckDir, "archive"),
    daemonPidPath: path.join(ckDir, "daemon.pid")
  };
};

export const ensureCkStructure = async (projectRoot = process.cwd()): Promise<LcdPaths> => {
  const paths = getCkPaths(projectRoot);
  await mkdir(paths.ckDir, { recursive: true });
  await mkdir(paths.archiveDir, { recursive: true });

  try {
    await stat(paths.contextPath);
  } catch {
    await writeFile(paths.contextPath, DEFAULT_LCD_TEMPLATE, "utf8");
  }

  try {
    await stat(paths.configPath);
  } catch {
    await writeFile(paths.configPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
  }

  try {
    await stat(paths.signalsPath);
  } catch {
    await writeFile(paths.signalsPath, "[]\n", "utf8");
  }

  return paths;
};

export const readLcd = async (projectRoot = process.cwd()): Promise<LcdDocument> => {
  const paths = getCkPaths(projectRoot);
  try {
    const file = await readFile(paths.contextPath, "utf8");
    const fileStat = await stat(paths.contextPath);
    return {
      path: paths.contextPath,
      content: file,
      exists: true,
      sizeBytes: fileStat.size,
      updatedAt: fileStat.mtime.toISOString()
    };
  } catch {
    return {
      path: paths.contextPath,
      content: "",
      exists: false,
      sizeBytes: 0,
      updatedAt: null
    };
  }
};

export const archiveLcdChunk = async ({
  projectRoot = process.cwd(),
  chunk,
  note
}: ArchiveChunkArgs): Promise<string> => {
  const paths = await ensureCkStructure(projectRoot);
  const archiveFile = path.join(paths.archiveDir, formatArchiveFileName(new Date()));
  const block = [
    `## ${getNowIso()}`,
    note ? `Note: ${note}` : "Note: archived LCD content",
    "",
    chunk.trim(),
    ""
  ].join("\n");

  let existing = "";
  try {
    existing = await readFile(archiveFile, "utf8");
  } catch {
    existing = "";
  }

  const next = existing.length > 0 ? `${existing.trimEnd()}\n\n${block}` : `${block}\n`;
  await writeFile(archiveFile, next, "utf8");
  return archiveFile;
};

export const writeLcd = async ({
  projectRoot = process.cwd(),
  content,
  archiveNote,
  archiveExisting = true
}: WriteLcdArgs): Promise<LcdDocument> => {
  const paths = await ensureCkStructure(projectRoot);
  const current = await readLcd(projectRoot);
  if (archiveExisting && current.exists && current.content.trim() !== content.trim()) {
    await archiveLcdChunk({
      projectRoot,
      chunk: current.content,
      note: archiveNote ?? "Replaced previous LCD"
    });
  }

  await writeFile(paths.contextPath, content, "utf8");
  const fileStat = await stat(paths.contextPath);
  return {
    path: paths.contextPath,
    content,
    exists: true,
    sizeBytes: fileStat.size,
    updatedAt: fileStat.mtime.toISOString()
  };
};

export const readSignals = async (projectRoot = process.cwd()): Promise<ManualSignal[]> => {
  const paths = await ensureCkStructure(projectRoot);
  const content = await readFile(paths.signalsPath, "utf8");
  const parsed = safeParseJson<ManualSignal[]>(content, []);
  return Array.isArray(parsed) ? parsed : [];
};

export const appendManualSignal = async (
  text: string,
  projectRoot = process.cwd()
): Promise<ManualSignal> => {
  const paths = await ensureCkStructure(projectRoot);
  const signals = await readSignals(projectRoot);
  const signal: ManualSignal = {
    id: randomUUID(),
    text,
    createdAt: getNowIso(),
    processedAt: null
  };
  const next = [...signals, signal];
  await writeFile(paths.signalsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return signal;
};

export const markSignalsProcessed = async (
  signalIds: string[],
  projectRoot = process.cwd()
): Promise<ManualSignal[]> => {
  const paths = await ensureCkStructure(projectRoot);
  const idSet = new Set(signalIds);
  const now = getNowIso();
  const next = (await readSignals(projectRoot)).map((signal) =>
    idSet.has(signal.id) && signal.processedAt === null
      ? {
          ...signal,
          processedAt: now
        }
      : signal
  );
  await writeFile(paths.signalsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
};

export const readCkConfig = async (projectRoot = process.cwd()): Promise<CkRuntimeConfig> => {
  const paths = await ensureCkStructure(projectRoot);
  const content = await readFile(paths.configPath, "utf8");
  const parsed = safeParseJson<unknown>(content, DEFAULT_CONFIG);
  return mergeConfig(parsed);
};

export const writeCkConfig = async (
  config: Partial<CkRuntimeConfig>,
  projectRoot = process.cwd()
): Promise<CkRuntimeConfig> => {
  const paths = await ensureCkStructure(projectRoot);
  const current = await readCkConfig(projectRoot);
  const merged = mergeConfig({ ...current, ...config });
  await writeFile(paths.configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  return merged;
};

export const getDefaultCkConfig = (): CkRuntimeConfig => ({
  ...DEFAULT_CONFIG,
  watchTriggers: [...DEFAULT_CONFIG.watchTriggers],
  fileIgnore: [...DEFAULT_CONFIG.fileIgnore],
  sections: { ...DEFAULT_CONFIG.sections },
  team: { ...DEFAULT_CONFIG.team }
});
