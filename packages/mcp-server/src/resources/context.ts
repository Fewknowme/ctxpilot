import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpPaths {
  projectRoot: string;
  ckDir: string;
  contextPath: string;
  configPath: string;
  signalsPath: string;
  archiveDir: string;
}

const DEFAULT_CONTEXT = "# Project Context\n\nctxpilot MCP initialized.\n";

export const getMcpPaths = (projectRoot: string): McpPaths => {
  const root = path.resolve(projectRoot);
  const ckDir = path.join(root, ".ctxpilot");
  return {
    projectRoot: root,
    ckDir,
    contextPath: path.join(ckDir, "context.md"),
    configPath: path.join(ckDir, "config.json"),
    signalsPath: path.join(ckDir, "signals.json"),
    archiveDir: path.join(ckDir, "archive")
  };
};

const formatArchiveDate = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}.md`;
};

const countTokensSafe = (text: string): number => {
  return Math.ceil(text.length / 4);
};

export const ensureMcpStorage = async (projectRoot: string): Promise<McpPaths> => {
  const paths = getMcpPaths(projectRoot);
  await mkdir(paths.ckDir, { recursive: true });
  await mkdir(paths.archiveDir, { recursive: true });

  try {
    await stat(paths.contextPath);
  } catch {
    await writeFile(paths.contextPath, DEFAULT_CONTEXT, "utf8");
  }

  try {
    await stat(paths.signalsPath);
  } catch {
    await writeFile(paths.signalsPath, "[]\n", "utf8");
  }

  try {
    await stat(paths.configPath);
  } catch {
    await writeFile(paths.configPath, "{\n  \"tokenBudget\": 2000\n}\n", "utf8");
  }

  return paths;
};

export const readCurrentContext = async (projectRoot: string): Promise<string> => {
  const paths = await ensureMcpStorage(projectRoot);
  return readFile(paths.contextPath, "utf8");
};

export const writeCurrentContext = async (projectRoot: string, content: string): Promise<void> => {
  const paths = await ensureMcpStorage(projectRoot);
  await writeFile(paths.contextPath, content, "utf8");
};

export const appendArchiveEntry = async (
  projectRoot: string,
  body: string,
  note: string
): Promise<string> => {
  const paths = await ensureMcpStorage(projectRoot);
  const archiveFile = path.join(paths.archiveDir, formatArchiveDate(new Date()));

  const section = [
    `## ${new Date().toISOString()}`,
    `Note: ${note}`,
    "",
    body.trim(),
    ""
  ].join("\n");

  let existing = "";
  try {
    existing = await readFile(archiveFile, "utf8");
  } catch {
    existing = "";
  }

  const merged = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${section}` : `${section}\n`;
  await writeFile(archiveFile, merged, "utf8");
  return archiveFile;
};

export const readArchiveFiles = async (projectRoot: string): Promise<string[]> => {
  const paths = await ensureMcpStorage(projectRoot);
  const files = await readdir(paths.archiveDir);
  return files.filter((file) => file.endsWith(".md")).sort().reverse();
};

export const readArchiveContent = async (
  projectRoot: string,
  archiveFile: string
): Promise<string> => {
  const paths = await ensureMcpStorage(projectRoot);
  return readFile(path.join(paths.archiveDir, archiveFile), "utf8");
};

export const readSignalsRaw = async (projectRoot: string): Promise<string> => {
  const paths = await ensureMcpStorage(projectRoot);
  return readFile(paths.signalsPath, "utf8");
};

export const readTokenBudget = async (projectRoot: string): Promise<number> => {
  const paths = await ensureMcpStorage(projectRoot);
  try {
    const raw = await readFile(paths.configPath, "utf8");
    const parsed = JSON.parse(raw) as { tokenBudget?: unknown };
    if (typeof parsed.tokenBudget === "number" && Number.isFinite(parsed.tokenBudget)) {
      return parsed.tokenBudget;
    }
  } catch {
    return 2000;
  }

  return 2000;
};

export const enforceMcpTokenBudget = (
  content: string,
  tokenBudget = 2000
): {
  withinBudget: boolean;
  tokenCount: number;
  tokenBudget: number;
} => {
  const tokenCount = countTokensSafe(content);
  return {
    withinBudget: tokenCount <= tokenBudget,
    tokenCount,
    tokenBudget
  };
};

export const shrinkToBudget = (
  content: string,
  tokenBudget: number
): {
  content: string;
  archivedOverflow: string;
  tokenCount: number;
} => {
  const initial = enforceMcpTokenBudget(content, tokenBudget);
  if (initial.withinBudget) {
    return {
      content,
      archivedOverflow: "",
      tokenCount: initial.tokenCount
    };
  }

  const ratio = tokenBudget / initial.tokenCount;
  const cutoff = Math.max(200, Math.floor(content.length * ratio * 0.95));
  const compact = `${content.slice(0, cutoff).trim()}\n\n<!-- compressed-by: mcp-fallback -->\n`;
  const final = enforceMcpTokenBudget(compact, tokenBudget);

  return {
    content: compact,
    archivedOverflow: content.slice(cutoff).trim(),
    tokenCount: final.tokenCount
  };
};

export const appendBulletToSection = (
  markdown: string,
  heading: string,
  bullet: string
): string => {
  const normalizedBullet = bullet.trim();
  if (normalizedBullet.length === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim() === heading.trim());
  const bulletLine = `- ${normalizedBullet}`;

  if (headingIndex < 0) {
    return `${markdown.trimEnd()}\n\n${heading}\n${bulletLine}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (lines[i]?.startsWith("## ")) {
      sectionEnd = i;
      break;
    }
  }

  const existing = new Set(
    lines
      .slice(headingIndex + 1, sectionEnd)
      .filter((line) => line.trimStart().startsWith("- "))
      .map((line) => line.trim().slice(2).trim())
  );

  if (existing.has(normalizedBullet)) {
    return markdown;
  }

  const updated = [...lines.slice(0, sectionEnd), bulletLine, ...lines.slice(sectionEnd)];
  return updated.join("\n");
};

export const registerContextResources = (server: McpServer, projectRoot: string): void => {
  server.registerResource(
    "project-current",
    "context://project/current",
    {
      title: "Current Project Context",
      description: "The current Living Context Document from .ctxpilot/context.md",
      mimeType: "text/markdown"
    },
    async () => {
      const context = await readCurrentContext(projectRoot);
      return {
        contents: [
          {
            uri: "context://project/current",
            text: context,
            mimeType: "text/markdown"
          }
        ]
      };
    }
  );

  server.registerResource(
    "project-archive",
    "context://project/archive",
    {
      title: "Archived Context Index",
      description: "List of archived context markdown files",
      mimeType: "application/json"
    },
    async () => {
      const files = await readArchiveFiles(projectRoot);
      return {
        contents: [
          {
            uri: "context://project/archive",
            text: JSON.stringify({ files }, null, 2),
            mimeType: "application/json"
          }
        ]
      };
    }
  );

  server.registerResource(
    "project-signals",
    "context://project/signals",
    {
      title: "Raw Manual Signals",
      description: "Unprocessed and processed manual signals from .ctxpilot/signals.json",
      mimeType: "application/json"
    },
    async () => {
      const signals = await readSignalsRaw(projectRoot);
      return {
        contents: [
          {
            uri: "context://project/signals",
            text: signals,
            mimeType: "application/json"
          }
        ]
      };
    }
  );
};
