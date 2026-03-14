#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import "./config/env.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ensureMcpStorage, registerContextResources } from "./resources/context.js";
import { registerAddBlockerTool } from "./tools/add_blocker.js";
import { registerAddDecisionTool } from "./tools/add_decision.js";
import { registerGetContextTool } from "./tools/get_context.js";
import { registerSearchArchiveTool } from "./tools/search_archive.js";
import { registerUpdateContextTool } from "./tools/update_context.js";

export const createMcpServer = (projectRoot: string): McpServer => {
  const server = new McpServer(
    {
      name: "ctxpilot",
      version: "0.1.1"
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  registerContextResources(server, projectRoot);
  registerGetContextTool(server, projectRoot);
  registerUpdateContextTool(server, projectRoot);
  registerAddDecisionTool(server, projectRoot);
  registerAddBlockerTool(server, projectRoot);
  registerSearchArchiveTool(server, projectRoot);

  return server;
};

export const startMcpServer = async (cwd = process.cwd()): Promise<void> => {
  await ensureMcpStorage(cwd);
  const server = createMcpServer(cwd);
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const isDirectExecution = (): boolean => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  startMcpServer(process.cwd()).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ctxpilot MCP server error: ${message}\n`);
    process.exit(1);
  });
}
