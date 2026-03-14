import { Command } from "commander";

import { startMcpServer } from "@ctxpilot/mcp-server";

export const runServe = async (): Promise<void> => {
  await startMcpServer(process.cwd());
};

export const registerServeCommand = (program: Command): void => {
  program
    .command("serve")
    .description("Start ctxpilot MCP server for the current project")
    .action(async () => {
      await runServe();
    });
};
