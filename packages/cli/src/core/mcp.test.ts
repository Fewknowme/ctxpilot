import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import {
  configureClaudeProjectRule,
  configureMcpClients,
  configureProjectCodexSkill,
  configureCursorProjectRule,
  configureWindsurfProjectRule,
  createMcpServerEntry,
  getProjectClaudeRulePath,
  getProjectCodexSkillPath,
  getProjectCursorRulePath,
  getProjectMcpServerName,
  getProjectWindsurfRulePath,
  mergeTomlMcpConfigContent,
  parseJsonConfigRoot,
  parseTomlConfigRoot,
  renderCodexMcpConfig,
  renderJsonMcpConfig,
  renderProjectInstructionBody,
  renderProjectCodexSkill,
  upsertJsonMcpConfig,
  upsertTomlMcpConfig
} from "./mcp.js";

const entry = createMcpServerEntry(
  "/Users/rohitmadas/otherstuff/dub",
  "/Users/rohitmadas/pronasoft/ctxpilot/packages/mcp-server/dist/index.js"
);

describe("mcp config helpers", () => {
  it("renders JSON client config with the expected MCP server entry", () => {
    const rendered = renderJsonMcpConfig(entry);
    const parsed = JSON.parse(rendered) as {
      mcpServers?: {
        "ctx-dub"?: {
          command?: string;
          args?: string[];
          cwd?: string;
        };
      };
    };

    expect(parsed.mcpServers?.["ctx-dub"]).toEqual({
      command: "node",
      args: ["/Users/rohitmadas/pronasoft/ctxpilot/packages/mcp-server/dist/index.js"],
      cwd: "/Users/rohitmadas/otherstuff/dub"
    });
  });

  it("upserts JSON config while preserving unrelated keys and servers", () => {
    const root = parseJsonConfigRoot(
      JSON.stringify({
        theme: "dark",
        mcpServers: {
          existing: {
            command: "node",
            args: ["existing.js"],
            cwd: "/tmp/existing"
          }
        }
      }),
      "claude_desktop_config.json"
    );

    const nextRoot = upsertJsonMcpConfig(root, entry, "claude_desktop_config.json");
    const mcpServers = nextRoot.mcpServers as Record<string, unknown>;
    const ctxpilotServer = mcpServers["ctx-dub"] as Record<string, unknown>;

    expect(nextRoot.theme).toBe("dark");
    expect(mcpServers.existing).toBeDefined();
    expect(ctxpilotServer.command).toBe("node");
    expect(ctxpilotServer.cwd).toBe("/Users/rohitmadas/otherstuff/dub");
  });

  it("upserts TOML config while preserving unrelated settings", () => {
    const root = parseTomlConfigRoot(
      [
        'model = "gpt-5.4"',
        '[mcp_servers.existing]',
        'command = "node"',
        'args = ["existing.js"]',
        'cwd = "/tmp/existing"'
      ].join("\n"),
      "config.toml"
    );

    const nextRoot = upsertTomlMcpConfig(root, entry, "config.toml");
    const rendered = renderCodexMcpConfig(entry);
    const nextServers = nextRoot.mcp_servers as Record<string, unknown>;
    const ctxpilotServer = nextServers["ctx-dub"] as Record<string, unknown>;

    expect(nextRoot.model).toBe("gpt-5.4");
    expect(nextServers.existing).toBeDefined();
    expect(ctxpilotServer.command).toBe("node");
    expect(rendered).toContain("[mcp_servers.ctx-dub]");
  });

  it("renders the project Codex skill with the LCD path and project MCP tool reference", () => {
    const rendered = renderProjectCodexSkill("/Users/rohitmadas/otherstuff/My Project");

    expect(rendered).toContain(".ctxpilot/context.md");
    expect(rendered).toContain("Call the ctx-my-project MCP get_context tool immediately");
  });

  it("renders the shared project instruction body with the LCD path and project MCP tool reference", () => {
    const rendered = renderProjectInstructionBody("/Users/rohitmadas/otherstuff/My Project");

    expect(rendered).toContain(".ctxpilot/context.md");
    expect(rendered).toContain("The MCP server ctx-my-project also exposes get_context tool");
  });

  it("preserves existing top-level TOML keys during a setup write", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const codexDir = path.join(tempHome, ".codex");
    const configPath = path.join(codexDir, "config.toml");

    try {
      await mkdir(codexDir, { recursive: true });
      await writeFile(
        configPath,
        [
          'model = "gpt-5.4"',
          'model_reasoning_effort = "xhigh"',
          'command = "node"',
          'args = ["/old/path.js"]'
        ].join("\n"),
        "utf8"
      );

      const results = await configureMcpClients(projectRoot, tempHome);
      const codexResult = results.find((result) => result.client.key === "codex-cli");
      const mergedContent = await readFile(configPath, "utf8");
      const mergedRoot = parseTomlConfigRoot(mergedContent, configPath);
      const mergedServers = mergedRoot.mcp_servers as Record<string, unknown>;
      const ctxpilotServer = mergedServers[getProjectMcpServerName(projectRoot)] as Record<string, unknown>;

      expect(codexResult?.status).toBe("configured");
      expect(mergedRoot.model).toBe("gpt-5.4");
      expect(mergedRoot.model_reasoning_effort).toBe("xhigh");
      expect(mergedRoot.command).toBe("node");
      expect(mergedRoot.args).toEqual(["/old/path.js"]);
      expect(ctxpilotServer.command).toBe("node");
      expect(ctxpilotServer.cwd).toBe(projectRoot);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates the project Codex skill when Codex CLI is configured", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const codexDir = path.join(tempHome, ".codex");

    try {
      await mkdir(codexDir, { recursive: true });

      const results = await configureMcpClients(projectRoot, tempHome);
      const skillResult = await configureProjectCodexSkill(projectRoot, results);
      const skillPath = getProjectCodexSkillPath(projectRoot);
      const skillContent = await readFile(skillPath, "utf8");

      expect(skillResult.status).toBe("created");
      expect(skillResult.skillPath).toBe(skillPath);
      expect(skillContent).toContain(".ctxpilot/context.md");
      expect(skillContent).toContain(
        `Call the ${getProjectMcpServerName(projectRoot)} MCP get_context tool immediately`
      );
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves an existing project Codex skill on rerun", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const codexDir = path.join(tempHome, ".codex");
    const customSkillContent = "# custom skill\n";

    try {
      await mkdir(codexDir, { recursive: true });

      const initialResults = await configureMcpClients(projectRoot, tempHome);
      const initialSkillResult = await configureProjectCodexSkill(projectRoot, initialResults);
      const skillPath = getProjectCodexSkillPath(projectRoot);

      expect(initialSkillResult.status).toBe("created");

      await writeFile(skillPath, customSkillContent, "utf8");

      const rerunResults = await configureMcpClients(projectRoot, tempHome);
      const rerunSkillResult = await configureProjectCodexSkill(projectRoot, rerunResults);
      const persistedContent = await readFile(skillPath, "utf8");

      expect(rerunSkillResult.status).toBe("existing");
      expect(persistedContent).toBe(customSkillContent);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not create the project Codex skill when Codex CLI is not installed", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const skillPath = getProjectCodexSkillPath(projectRoot);

    try {
      const results = await configureMcpClients(projectRoot, tempHome);
      const skillResult = await configureProjectCodexSkill(projectRoot, results);
      const codexResult = results.find((result) => result.client.key === "codex-cli");

      expect(codexResult?.status).toBe("skipped");
      expect(skillResult.status).toBe("skipped");
      await expect(readFile(skillPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates CLAUDE.md when missing", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));

    try {
      const result = await configureClaudeProjectRule(projectRoot);
      const filePath = getProjectClaudeRulePath(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("created");
      expect(content).toContain("At the start of every session, read .ctxpilot/context.md first.");
      expect(content).toContain(
        `The MCP server ${getProjectMcpServerName(projectRoot)} also exposes get_context tool`
      );
      expect(content.startsWith("---\n")).toBe(true);
      expect(content.trimEnd().endsWith("---")).toBe(true);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("appends a ctxpilot section to CLAUDE.md when the file lacks ctxpilot instructions", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const filePath = getProjectClaudeRulePath(projectRoot);

    try {
      await writeFile(filePath, "# Team Notes\n", "utf8");

      const result = await configureClaudeProjectRule(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("appended");
      expect(content).toContain("# Team Notes");
      expect(content).toContain("## ctxpilot");
      expect(content).toContain("At the start of every session, read .ctxpilot/context.md first.");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("leaves CLAUDE.md unchanged when a ctxpilot section already exists", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const filePath = getProjectClaudeRulePath(projectRoot);
    const existingContent = "# Team Notes\n\n## ctxpilot\n\nAlready configured.\n";

    try {
      await writeFile(filePath, existingContent, "utf8");

      const result = await configureClaudeProjectRule(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("existing");
      expect(content).toBe(existingContent);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("leaves CLAUDE.md unchanged when the LCD instruction sentence is already present", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const filePath = getProjectClaudeRulePath(projectRoot);
    const existingContent = [
      "# Team Notes",
      "",
      "At the start of every session, read .ctxpilot/context.md first."
    ].join("\n");

    try {
      await writeFile(filePath, existingContent, "utf8");

      const result = await configureClaudeProjectRule(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("existing");
      expect(content).toBe(existingContent);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates the Cursor rule when Cursor is installed", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const cursorDir = path.join(tempHome, ".cursor");

    try {
      await mkdir(cursorDir, { recursive: true });

      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureCursorProjectRule(projectRoot, results);
      const filePath = getProjectCursorRulePath(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("created");
      expect(content).toContain("description: Load project context from ctxpilot LCD at session start");
      expect(content).toContain("alwaysApply: true");
      expect(content).toContain("At the start of every session, read .ctxpilot/context.md first.");
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("skips the Cursor rule when Cursor is not installed", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const filePath = getProjectCursorRulePath(projectRoot);

    try {
      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureCursorProjectRule(projectRoot, results);

      expect(result.status).toBe("skipped");
      await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves an existing Cursor rule unchanged", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const cursorDir = path.join(tempHome, ".cursor");
    const filePath = getProjectCursorRulePath(projectRoot);
    const existingContent = "# custom cursor rule\n";

    try {
      await mkdir(cursorDir, { recursive: true });
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, existingContent, "utf8");

      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureCursorProjectRule(projectRoot, results);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("existing");
      expect(content).toBe(existingContent);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates the Windsurf rule when Windsurf is installed", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const windsurfDir = path.join(tempHome, ".windsurf");

    try {
      await mkdir(windsurfDir, { recursive: true });

      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureWindsurfProjectRule(projectRoot, results);
      const filePath = getProjectWindsurfRulePath(projectRoot);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("created");
      expect(content).toContain("At the start of every session, read .ctxpilot/context.md first.");
      expect(content).toContain(
        `The MCP server ${getProjectMcpServerName(projectRoot)} also exposes get_context tool`
      );
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("skips the Windsurf rule when Windsurf is not installed", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const filePath = getProjectWindsurfRulePath(projectRoot);

    try {
      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureWindsurfProjectRule(projectRoot, results);

      expect(result.status).toBe("skipped");
      await expect(readFile(filePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("preserves an existing Windsurf rule unchanged", async () => {
    const tempHome = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-home-"));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ctx-mcp-project-"));
    const windsurfDir = path.join(tempHome, ".windsurf");
    const filePath = getProjectWindsurfRulePath(projectRoot);
    const existingContent = "# custom windsurf rule\n";

    try {
      await mkdir(windsurfDir, { recursive: true });
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, existingContent, "utf8");

      const results = await configureMcpClients(projectRoot, tempHome);
      const result = await configureWindsurfProjectRule(projectRoot, results);
      const content = await readFile(filePath, "utf8");

      expect(result.status).toBe("existing");
      expect(content).toBe(existingContent);
    } finally {
      await rm(tempHome, { recursive: true, force: true });
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("merges TOML content without dropping top-level keys", () => {
    const mergedContent = mergeTomlMcpConfigContent(
      [
        'model = "gpt-5.4"',
        'model_reasoning_effort = "xhigh"',
        'command = "node"',
        'args = ["/old/path.js"]'
      ].join("\n"),
      entry,
      "config.toml"
    );
    const mergedRoot = parseTomlConfigRoot(mergedContent, "config.toml");

    expect(mergedRoot.model).toBe("gpt-5.4");
    expect(mergedRoot.model_reasoning_effort).toBe("xhigh");
    expect(mergedRoot.command).toBe("node");
    expect(mergedRoot.args).toEqual(["/old/path.js"]);
  });

  it("rejects invalid JSON MCP config shapes", () => {
    const root = parseJsonConfigRoot(
      JSON.stringify({
        mcpServers: []
      }),
      "mcp.json"
    );

    expect(() => upsertJsonMcpConfig(root, entry, "mcp.json")).toThrow(
      "mcp.json has an invalid mcpServers value"
    );
  });
});
