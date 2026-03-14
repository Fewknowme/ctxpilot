import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as TOML from "@iarna/toml";

export type McpClientKey = "claude-code" | "codex-cli" | "cursor" | "windsurf";
export type McpClientFormat = "json" | "toml";
export type McpSetupStatus = "configured" | "skipped" | "failed";

export interface McpServerEntry {
  name: string;
  command: string;
  args: string[];
  cwd: string;
}

export interface McpClientTarget {
  key: McpClientKey;
  label: string;
  directoryPath: string;
  configPath: string;
  format: McpClientFormat;
}

export interface McpConfigSnippets {
  claudeCode: string;
  codexCli: string;
  cursorWindsurf: string;
  scriptPath: string;
  serverName: string;
}

export interface McpSetupResult {
  client: McpClientTarget;
  status: McpSetupStatus;
  detail: string;
  serverName: string;
}

export type CodexProjectSkillStatus = "created" | "existing" | "skipped";

export interface CodexProjectSkillResult {
  status: CodexProjectSkillStatus;
  detail: string;
  skillPath: string;
  serverName: string;
}

export type ProjectInstructionTool = "claude-code" | "cursor" | "windsurf";
export type ProjectInstructionStatus = "created" | "existing" | "appended" | "skipped";

export interface ProjectInstructionResult {
  tool: ProjectInstructionTool;
  status: ProjectInstructionStatus;
  detail: string;
  filePath: string;
  serverName: string;
}

type TomlMap = Parameters<typeof TOML.stringify>[0];
const PROJECT_CLAUDE_RULE_PATH_SEGMENTS = ["CLAUDE.md"] as const;
const PROJECT_CURSOR_RULE_PATH_SEGMENTS = [".cursor", "rules", "ctxpilot.mdc"] as const;
const PROJECT_WINDSURF_RULE_PATH_SEGMENTS = [".windsurf", "rules", "ctxpilot.md"] as const;
const PROJECT_CODEX_SKILL_PATH_SEGMENTS = [".agents", "skills", "ctxpilot", "SKILL.md"] as const;
const CLAUDE_CTXPILOT_SECTION_HEADING = "## ctxpilot";
const PROJECT_INSTRUCTION_SENTENCE = "At the start of every session, read .ctxpilot/context.md first.";
const CURSOR_RULE_DESCRIPTION = "Load project context from ctxpilot LCD at session start";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isTomlMap = (value: unknown): value is TomlMap => {
  return isRecord(value);
};

const normalizeResolvedPath = (resolvedPath: string): string => {
  if (resolvedPath.startsWith("file://")) {
    return fileURLToPath(resolvedPath);
  }

  return resolvedPath;
};

const withTrailingNewline = (value: string): string => {
  return value.endsWith("\n") ? value : `${value}\n`;
};

const createEntryRecord = (entry: McpServerEntry): Record<string, unknown> => {
  return {
    command: entry.command,
    args: [...entry.args],
    cwd: entry.cwd
  };
};

export const getProjectMcpServerName = (projectRoot: string): string => {
  const projectName = path.basename(path.resolve(projectRoot));
  const normalized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `ctx-${normalized.length > 0 ? normalized : "project"}`;
};

const createTomlEntryRecord = (entry: McpServerEntry): TomlMap => {
  return {
    command: entry.command,
    args: [...entry.args],
    cwd: entry.cwd
  };
};

const readConfigIfExists = async (filePath: string): Promise<string> => {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }

    throw error;
  }
};

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await access(targetPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const directoryExists = async (directoryPath: string): Promise<boolean> => {
  return pathExists(directoryPath);
};

const hasClaudeCtxpilotInstructions = (content: string): boolean => {
  return /^##\s+ctxpilot\s*$/im.test(content) || content.includes(PROJECT_INSTRUCTION_SENTENCE);
};

const appendMarkdownSection = (
  content: string,
  heading: string,
  sectionBody: string
): string => {
  const normalizedContent = content.trimEnd();
  const normalizedSectionBody = sectionBody.trim();

  if (normalizedContent.length === 0) {
    return `${heading}\n\n${normalizedSectionBody}\n`;
  }

  return `${normalizedContent}\n\n${heading}\n\n${normalizedSectionBody}\n`;
};

const getClientSetupResult = (
  results: McpSetupResult[],
  clientKey: McpClientKey
): McpSetupResult | undefined => {
  return results.find((result) => result.client.key === clientKey);
};

const createProjectInstructionResult = (
  tool: ProjectInstructionTool,
  status: ProjectInstructionStatus,
  filePath: string,
  detail: string,
  serverName: string
): ProjectInstructionResult => {
  return {
    tool,
    status,
    detail,
    filePath,
    serverName
  };
};

const findInstalledMcpServerScriptPath = async (): Promise<string> => {
  const startDirectory = path.dirname(fileURLToPath(import.meta.url));
  let currentDirectory = startDirectory;

  while (true) {
    const candidate = path.join(
      currentDirectory,
      "node_modules",
      "@ctxpilot",
      "mcp-server",
      "dist",
      "index.js"
    );

    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      const parentDirectory = path.dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        break;
      }
      currentDirectory = parentDirectory;
    }
  }

  throw new Error("Could not locate node_modules/@ctxpilot/mcp-server/dist/index.js.");
};

export const getMcpClientTargets = (homeDirectory = os.homedir()): McpClientTarget[] => {
  return [
    {
      key: "claude-code",
      label: "Claude Code",
      directoryPath: path.join(homeDirectory, ".claude"),
      configPath: path.join(homeDirectory, ".claude", "claude_desktop_config.json"),
      format: "json"
    },
    {
      key: "codex-cli",
      label: "Codex CLI",
      directoryPath: path.join(homeDirectory, ".codex"),
      configPath: path.join(homeDirectory, ".codex", "config.toml"),
      format: "toml"
    },
    {
      key: "cursor",
      label: "Cursor",
      directoryPath: path.join(homeDirectory, ".cursor"),
      configPath: path.join(homeDirectory, ".cursor", "mcp.json"),
      format: "json"
    },
    {
      key: "windsurf",
      label: "Windsurf",
      directoryPath: path.join(homeDirectory, ".windsurf"),
      configPath: path.join(homeDirectory, ".windsurf", "mcp.json"),
      format: "json"
    }
  ];
};

export const resolveInstalledMcpServerScriptPath = async (): Promise<string> => {
  try {
    const metaResolve = Reflect.get(import.meta, "resolve");
    const resolvedPath =
      typeof metaResolve === "function"
        ? normalizeResolvedPath(metaResolve.call(import.meta, "@ctxpilot/mcp-server") as string)
        : await findInstalledMcpServerScriptPath();
    await access(resolvedPath, constants.R_OK);
    return resolvedPath;
  } catch (error) {
    try {
      return await findInstalledMcpServerScriptPath();
    } catch {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not resolve the installed @ctxpilot/mcp-server entry. Run npm run build in the ctxpilot repo and ensure dependencies are installed. ${message}`
      );
    }
  }
};

export const createMcpServerEntry = (
  projectRoot: string,
  serverScriptPath: string
): McpServerEntry => {
  // TODO: switch generated configs back to `npx ctxpilot serve` after npm publish.
  return {
    name: getProjectMcpServerName(projectRoot),
    command: "node",
    args: [serverScriptPath],
    cwd: projectRoot
  };
};

export const getProjectCodexSkillPath = (projectRoot: string): string => {
  return path.join(path.resolve(projectRoot), ...PROJECT_CODEX_SKILL_PATH_SEGMENTS);
};

export const getProjectClaudeRulePath = (projectRoot: string): string => {
  return path.join(path.resolve(projectRoot), ...PROJECT_CLAUDE_RULE_PATH_SEGMENTS);
};

export const getProjectCursorRulePath = (projectRoot: string): string => {
  return path.join(path.resolve(projectRoot), ...PROJECT_CURSOR_RULE_PATH_SEGMENTS);
};

export const getProjectWindsurfRulePath = (projectRoot: string): string => {
  return path.join(path.resolve(projectRoot), ...PROJECT_WINDSURF_RULE_PATH_SEGMENTS);
};

export const renderProjectInstructionBody = (projectRoot: string): string => {
  const serverName = getProjectMcpServerName(projectRoot);

  return withTrailingNewline(`At the start of every session, read .ctxpilot/context.md first.
This is the Living Context Document (LCD) — it contains the current
project goal, architecture decisions, active work, and coding conventions.
Use it as primary context before exploring files.
The MCP server ${serverName} also exposes get_context tool
for programmatic access.`);
};

export const renderClaudeProjectInstructions = (projectRoot: string): string => {
  return withTrailingNewline(`---
${renderProjectInstructionBody(projectRoot).trimEnd()}
---`);
};

export const renderCursorProjectInstructions = (projectRoot: string): string => {
  return withTrailingNewline(`---
description: ${CURSOR_RULE_DESCRIPTION}
alwaysApply: true
---

${renderProjectInstructionBody(projectRoot).trimEnd()}`);
};

export const renderWindsurfProjectInstructions = (projectRoot: string): string => {
  return renderProjectInstructionBody(projectRoot);
};

export const renderProjectCodexSkill = (projectRoot: string): string => {
  const serverName = getProjectMcpServerName(projectRoot);

  return withTrailingNewline(`---
name: ctxpilot
description: >
  Always use this skill at the start of every session to load project
  context. Reads the Living Context Document (LCD) from .ctxpilot/context.md
  and uses it as the primary source of truth for what this project is,
  what is currently being worked on, active goals, architecture decisions,
  and coding conventions. Use this before exploring files.
---

## Instructions
At the start of every session:
1. Call the ${serverName} MCP get_context tool immediately
2. Use the returned LCD as your primary context
3. Only explore files to supplement the LCD, not replace it
4. When the user asks "what am I working on" or "what is this project",
   answer from the LCD first

The LCD is always more accurate than README.md for current state.
`);
};

export const ensureProjectCodexSkill = async (
  projectRoot: string
): Promise<CodexProjectSkillResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const skillPath = getProjectCodexSkillPath(normalizedRoot);
  const serverName = getProjectMcpServerName(normalizedRoot);

  if (await pathExists(skillPath)) {
    return {
      status: "existing",
      detail: skillPath,
      skillPath,
      serverName
    };
  }

  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, renderProjectCodexSkill(normalizedRoot), "utf8");

  return {
    status: "created",
    detail: skillPath,
    skillPath,
    serverName
  };
};

export const configureProjectCodexSkill = async (
  projectRoot: string,
  results: McpSetupResult[]
): Promise<CodexProjectSkillResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const skillPath = getProjectCodexSkillPath(normalizedRoot);
  const codexResult = getClientSetupResult(results, "codex-cli");
  const serverName = codexResult?.serverName ?? getProjectMcpServerName(normalizedRoot);

  if (codexResult?.status !== "configured") {
    return {
      status: "skipped",
      detail:
        codexResult === undefined
          ? "Codex CLI was not part of the MCP setup results"
          : codexResult.status === "failed"
            ? `Codex CLI MCP setup failed: ${codexResult.detail}`
            : codexResult.detail,
      skillPath,
      serverName
    };
  }

  return ensureProjectCodexSkill(normalizedRoot);
};

const ensureProjectInstructionFile = async (
  tool: ProjectInstructionTool,
  projectRoot: string,
  filePath: string,
  content: string
): Promise<ProjectInstructionResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const serverName = getProjectMcpServerName(normalizedRoot);

  if (await pathExists(filePath)) {
    return createProjectInstructionResult(tool, "existing", filePath, filePath, serverName);
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return createProjectInstructionResult(tool, "created", filePath, filePath, serverName);
};

export const configureClaudeProjectRule = async (
  projectRoot: string
): Promise<ProjectInstructionResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const filePath = getProjectClaudeRulePath(normalizedRoot);
  const serverName = getProjectMcpServerName(normalizedRoot);

  if (!(await pathExists(filePath))) {
    await writeFile(filePath, renderClaudeProjectInstructions(normalizedRoot), "utf8");
    return createProjectInstructionResult("claude-code", "created", filePath, filePath, serverName);
  }

  const existingContent = await readFile(filePath, "utf8");
  if (hasClaudeCtxpilotInstructions(existingContent)) {
    return createProjectInstructionResult("claude-code", "existing", filePath, filePath, serverName);
  }

  const nextContent = appendMarkdownSection(
    existingContent,
    CLAUDE_CTXPILOT_SECTION_HEADING,
    renderProjectInstructionBody(normalizedRoot)
  );
  await writeFile(filePath, nextContent, "utf8");

  return createProjectInstructionResult("claude-code", "appended", filePath, filePath, serverName);
};

export const configureCursorProjectRule = async (
  projectRoot: string,
  results: McpSetupResult[]
): Promise<ProjectInstructionResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const filePath = getProjectCursorRulePath(normalizedRoot);
  const serverName = getProjectMcpServerName(normalizedRoot);
  const cursorResult = getClientSetupResult(results, "cursor");

  if (cursorResult === undefined || cursorResult.status === "skipped") {
    return createProjectInstructionResult("cursor", "skipped", filePath, "not installed", serverName);
  }

  return ensureProjectInstructionFile(
    "cursor",
    normalizedRoot,
    filePath,
    renderCursorProjectInstructions(normalizedRoot)
  );
};

export const configureWindsurfProjectRule = async (
  projectRoot: string,
  results: McpSetupResult[]
): Promise<ProjectInstructionResult> => {
  const normalizedRoot = path.resolve(projectRoot);
  const filePath = getProjectWindsurfRulePath(normalizedRoot);
  const serverName = getProjectMcpServerName(normalizedRoot);
  const windsurfResult = getClientSetupResult(results, "windsurf");

  if (windsurfResult === undefined || windsurfResult.status === "skipped") {
    return createProjectInstructionResult("windsurf", "skipped", filePath, "not installed", serverName);
  }

  return ensureProjectInstructionFile(
    "windsurf",
    normalizedRoot,
    filePath,
    renderWindsurfProjectInstructions(normalizedRoot)
  );
};

export const renderJsonMcpConfig = (entry: McpServerEntry): string => {
  return withTrailingNewline(
    JSON.stringify(
      {
        mcpServers: {
          [entry.name]: createEntryRecord(entry)
        }
      },
      null,
      2
    )
  );
};

export const renderCodexMcpConfig = (entry: McpServerEntry): string => {
  const root: TomlMap = {
    mcp_servers: {
      [entry.name]: createTomlEntryRecord(entry)
    }
  };

  return withTrailingNewline(
    TOML.stringify(root)
  );
};

export const getMcpConfigSnippets = async (
  projectRoot: string
): Promise<McpConfigSnippets> => {
  const scriptPath = await resolveInstalledMcpServerScriptPath();
  const entry = createMcpServerEntry(projectRoot, scriptPath);

  return {
    claudeCode: renderJsonMcpConfig(entry),
    codexCli: renderCodexMcpConfig(entry),
    cursorWindsurf: renderJsonMcpConfig(entry),
    scriptPath,
    serverName: entry.name
  };
};

export const parseJsonConfigRoot = (
  content: string,
  filePath: string
): Record<string, unknown> => {
  const normalizedContent = content.trim();
  if (normalizedContent.length === 0) {
    return {};
  }

  const parsed = JSON.parse(normalizedContent) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object at the top level.`);
  }

  return parsed;
};

export const parseTomlConfigRoot = (
  content: string,
  filePath: string
): TomlMap => {
  const normalizedContent = content.trim();
  if (normalizedContent.length === 0) {
    return {};
  }

  const parsed = TOML.parse(normalizedContent) as unknown;
  if (!isTomlMap(parsed)) {
    throw new Error(`${filePath} must contain a TOML table at the top level.`);
  }

  return parsed;
};

export const upsertJsonMcpConfig = (
  root: Record<string, unknown>,
  entry: McpServerEntry,
  filePath: string
): Record<string, unknown> => {
  const existingServers = root.mcpServers;
  if (existingServers !== undefined && !isRecord(existingServers)) {
    throw new Error(`${filePath} has an invalid mcpServers value. Expected an object.`);
  }

  return {
    ...root,
    mcpServers: {
      ...(isRecord(existingServers) ? existingServers : {}),
      [entry.name]: createEntryRecord(entry)
    }
  };
};

export const upsertTomlMcpConfig = (
  root: TomlMap,
  entry: McpServerEntry,
  filePath: string
): TomlMap => {
  const existingServers = root.mcp_servers;
  if (existingServers !== undefined && !isTomlMap(existingServers)) {
    throw new Error(`${filePath} has an invalid mcp_servers value. Expected a table.`);
  }

  const nextServers: TomlMap = {
    ...(isTomlMap(existingServers) ? existingServers : {}),
    [entry.name]: createTomlEntryRecord(entry)
  };

  return {
    ...root,
    mcp_servers: nextServers
  };
};

export const mergeJsonMcpConfigContent = (
  content: string,
  entry: McpServerEntry,
  filePath: string
): string => {
  const parsedRoot = parseJsonConfigRoot(content, filePath);
  const nextRoot = upsertJsonMcpConfig(parsedRoot, entry, filePath);
  return withTrailingNewline(JSON.stringify(nextRoot, null, 2));
};

export const mergeTomlMcpConfigContent = (
  content: string,
  entry: McpServerEntry,
  filePath: string
): string => {
  const parsedRoot = parseTomlConfigRoot(content, filePath);
  const nextRoot = upsertTomlMcpConfig(parsedRoot, entry, filePath);
  return withTrailingNewline(TOML.stringify(nextRoot));
};

const writeJsonClientConfig = async (
  target: McpClientTarget,
  entry: McpServerEntry
): Promise<McpSetupResult> => {
  try {
    const content = await readConfigIfExists(target.configPath);
    const nextContent = mergeJsonMcpConfigContent(content, entry, target.configPath);

    await mkdir(path.dirname(target.configPath), { recursive: true });
    await writeFile(target.configPath, nextContent, "utf8");

    return {
      client: target,
      status: "configured",
      detail: target.configPath,
      serverName: entry.name
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      client: target,
      status: "failed",
      detail: message,
      serverName: entry.name
    };
  }
};

const writeTomlClientConfig = async (
  target: McpClientTarget,
  entry: McpServerEntry
): Promise<McpSetupResult> => {
  try {
    const content = await readConfigIfExists(target.configPath);
    const nextContent = mergeTomlMcpConfigContent(content, entry, target.configPath);

    await mkdir(path.dirname(target.configPath), { recursive: true });
    await writeFile(target.configPath, nextContent, "utf8");

    return {
      client: target,
      status: "configured",
      detail: target.configPath,
      serverName: entry.name
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      client: target,
      status: "failed",
      detail: message,
      serverName: entry.name
    };
  }
};

export const configureMcpClients = async (
  projectRoot: string,
  homeDirectory = os.homedir()
): Promise<McpSetupResult[]> => {
  const scriptPath = await resolveInstalledMcpServerScriptPath();
  const entry = createMcpServerEntry(projectRoot, scriptPath);
  const targets = getMcpClientTargets(homeDirectory);

  return Promise.all(
    targets.map(async (target) => {
      const installed = await directoryExists(target.directoryPath);
      if (!installed) {
        return {
          client: target,
          status: "skipped",
          detail: `${target.directoryPath} is not installed`,
          serverName: entry.name
        } satisfies McpSetupResult;
      }

      if (target.format === "json") {
        return writeJsonClientConfig(target, entry);
      }

      return writeTomlClientConfig(target, entry);
    })
  );
};
