import { Command } from "commander";

import {
  configureClaudeProjectRule,
  configureProjectCodexSkill,
  configureCursorProjectRule,
  configureWindsurfProjectRule,
  configureMcpClients,
  type CodexProjectSkillResult,
  type McpSetupResult,
  type ProjectInstructionResult
} from "../core/mcp.js";

const formatResultLine = (result: McpSetupResult): string => {
  return `- ${result.client.label} (${result.serverName}): ${result.detail}\n`;
};

const formatCodexSkillLine = (result: CodexProjectSkillResult): string => {
  switch (result.status) {
    case "created":
      return `Codex project skill: created (${result.skillPath})\n`;
    case "existing":
      return `Codex project skill: already exists (${result.skillPath})\n`;
    case "skipped":
      return `Codex project skill: skipped (${result.detail})\n`;
  }

  throw new Error(`Unsupported Codex project skill result: ${JSON.stringify(result)}`);
};

const formatProjectInstructionLine = (result: ProjectInstructionResult): string => {
  switch (result.tool) {
    case "claude-code":
      switch (result.status) {
        case "created":
          return "Claude Code rule: created CLAUDE.md\n";
        case "appended":
          return "Claude Code rule: already exists, appended ctxpilot section\n";
        case "existing":
          return "Claude Code rule: already exists\n";
        case "skipped":
          return `Claude Code rule: skipped (${result.detail})\n`;
      }
    case "cursor":
      switch (result.status) {
        case "created":
          return "Cursor rule: created .cursor/rules/ctxpilot.mdc\n";
        case "existing":
          return "Cursor rule: already exists\n";
        case "skipped":
          return "Cursor rule: skipped (not installed)\n";
        case "appended":
          return "Cursor rule: already exists\n";
      }
    case "windsurf":
      switch (result.status) {
        case "created":
          return "Windsurf rule: created .windsurf/rules/ctxpilot.md\n";
        case "existing":
          return "Windsurf rule: already exists\n";
        case "skipped":
          return "Windsurf rule: skipped (not installed)\n";
        case "appended":
          return "Windsurf rule: already exists\n";
      }
  }

  throw new Error(`Unsupported project instruction result: ${JSON.stringify(result)}`);
};

interface PostSetupError {
  label: string;
  message: string;
}

export interface SetupCommandResult {
  results: McpSetupResult[];
  codexSkillResult: CodexProjectSkillResult | null;
  claudeRuleResult: ProjectInstructionResult | null;
  cursorRuleResult: ProjectInstructionResult | null;
  windsurfRuleResult: ProjectInstructionResult | null;
  postSetupErrors: PostSetupError[];
}

export const runSetupCommand = async (projectRoot: string): Promise<SetupCommandResult> => {
  const results = await configureMcpClients(projectRoot);
  let codexSkillResult: CodexProjectSkillResult | null = null;
  let claudeRuleResult: ProjectInstructionResult | null = null;
  let cursorRuleResult: ProjectInstructionResult | null = null;
  let windsurfRuleResult: ProjectInstructionResult | null = null;
  const postSetupErrors: PostSetupError[] = [];

  try {
    codexSkillResult = await configureProjectCodexSkill(projectRoot, results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postSetupErrors.push({
      label: "Codex project skill",
      message
    });
  }

  try {
    claudeRuleResult = await configureClaudeProjectRule(projectRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postSetupErrors.push({
      label: "Claude Code rule",
      message
    });
  }

  try {
    cursorRuleResult = await configureCursorProjectRule(projectRoot, results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postSetupErrors.push({
      label: "Cursor rule",
      message
    });
  }

  try {
    windsurfRuleResult = await configureWindsurfProjectRule(projectRoot, results);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    postSetupErrors.push({
      label: "Windsurf rule",
      message
    });
  }

  return {
    results,
    codexSkillResult,
    claudeRuleResult,
    cursorRuleResult,
    windsurfRuleResult,
    postSetupErrors
  };
};

export const registerSetupCommand = (program: Command): void => {
  program
    .command("setup")
    .description("Configure ctxpilot MCP entries for installed AI clients")
    .action(async () => {
      const projectRoot = process.cwd();
      const {
        results,
        codexSkillResult,
        claudeRuleResult,
        cursorRuleResult,
        windsurfRuleResult,
        postSetupErrors
      } = await runSetupCommand(projectRoot);
      const serverName = results[0]?.serverName;
      const configured = results.filter((result) => result.status === "configured");
      const skipped = results.filter((result) => result.status === "skipped");
      const failed = results.filter((result) => result.status === "failed");
      const codexSkillError = postSetupErrors.find((error) => error.label === "Codex project skill");
      const claudeRuleError = postSetupErrors.find((error) => error.label === "Claude Code rule");
      const cursorRuleError = postSetupErrors.find((error) => error.label === "Cursor rule");
      const windsurfRuleError = postSetupErrors.find((error) => error.label === "Windsurf rule");

      process.stdout.write(`ctxpilot MCP setup for ${projectRoot}\n`);
      if (typeof serverName === "string") {
        process.stdout.write(`Project server name: ${serverName}\n`);
      }

      if (configured.length > 0) {
        process.stdout.write("Configured:\n");
        for (const result of configured) {
          process.stdout.write(formatResultLine(result));
        }
      }

      if (skipped.length > 0) {
        process.stdout.write("Skipped (not installed):\n");
        for (const result of skipped) {
          process.stdout.write(formatResultLine(result));
        }
      }

      if (codexSkillResult !== null) {
        process.stdout.write(formatCodexSkillLine(codexSkillResult));
      } else if (codexSkillError !== undefined) {
        process.stdout.write(`${codexSkillError.label}: failed (${codexSkillError.message})\n`);
      }

      if (claudeRuleResult !== null) {
        process.stdout.write(formatProjectInstructionLine(claudeRuleResult));
      } else if (claudeRuleError !== undefined) {
        process.stdout.write(`${claudeRuleError.label}: failed (${claudeRuleError.message})\n`);
      }

      if (cursorRuleResult !== null) {
        process.stdout.write(formatProjectInstructionLine(cursorRuleResult));
      } else if (cursorRuleError !== undefined) {
        process.stdout.write(`${cursorRuleError.label}: failed (${cursorRuleError.message})\n`);
      }

      if (windsurfRuleResult !== null) {
        process.stdout.write(formatProjectInstructionLine(windsurfRuleResult));
      } else if (windsurfRuleError !== undefined) {
        process.stdout.write(`${windsurfRuleError.label}: failed (${windsurfRuleError.message})\n`);
      }

      if (failed.length > 0 || postSetupErrors.length > 0) {
        if (failed.length > 0) {
          process.stdout.write("Failed:\n");
          for (const result of failed) {
            process.stdout.write(formatResultLine(result));
          }
        }

        if (failed.length > 0 && postSetupErrors.length > 0) {
          throw new Error(
            `Failed to configure ${failed.length} client(s) and ${postSetupErrors.length} project instruction artifact(s).`
          );
        }

        if (postSetupErrors.length > 0) {
          throw new Error(`Failed to create ${postSetupErrors.length} project instruction artifact(s).`);
        }

        throw new Error(`Failed to configure ${failed.length} client(s).`);
      }
    });
};
