import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  appendArchiveEntry,
  enforceMcpTokenBudget,
  readCurrentContext,
  readTokenBudget,
  shrinkToBudget,
  writeCurrentContext
} from "../resources/context.js";

export interface ContextUpdateOptions {
  projectRoot: string;
  content: string;
  merge: boolean;
  note: string;
}

export interface ContextUpdateResult {
  content: string;
  tokenCount: number;
  tokenBudget: number;
  archivedPreviousContext: boolean;
  overflowArchived: boolean;
}

export const applyContextUpdate = async (
  options: ContextUpdateOptions
): Promise<ContextUpdateResult> => {
  const existing = await readCurrentContext(options.projectRoot);
  const mergedContent = options.merge
    ? `${existing.trimEnd()}\n\n${options.content.trim()}\n`
    : options.content;

  let archivedPreviousContext = false;
  if (existing.trim() !== mergedContent.trim()) {
    await appendArchiveEntry(
      options.projectRoot,
      existing,
      `${options.note} (pre-update snapshot)`
    );
    archivedPreviousContext = true;
  }

  const budget = await readTokenBudget(options.projectRoot);
  const shrunk = shrinkToBudget(mergedContent, budget);

  let overflowArchived = false;
  if (shrunk.archivedOverflow.trim().length > 0) {
    await appendArchiveEntry(
      options.projectRoot,
      shrunk.archivedOverflow,
      `${options.note} (token budget overflow)`
    );
    overflowArchived = true;
  }

  await writeCurrentContext(options.projectRoot, shrunk.content);
  const budgetState = enforceMcpTokenBudget(shrunk.content, budget);

  return {
    content: shrunk.content,
    tokenCount: budgetState.tokenCount,
    tokenBudget: budget,
    archivedPreviousContext,
    overflowArchived
  };
};

export const registerUpdateContextTool = (
  server: McpServer,
  projectRoot: string
): void => {
  server.registerTool(
    "update_context",
    {
      description: "Replace or merge content into the Living Context Document",
      inputSchema: {
        content: z.string().min(1),
        merge: z.boolean().optional()
      }
    },
    async ({ content, merge }) => {
      const result = await applyContextUpdate({
        projectRoot,
        content,
        merge: merge ?? false,
        note: "MCP update_context"
      });

      return {
        content: [
          {
            type: "text",
            text: `Context updated (${result.tokenCount}/${result.tokenBudget} tokens).`
          }
        ],
        structuredContent: {
          tokenCount: result.tokenCount,
          tokenBudget: result.tokenBudget,
          archivedPreviousContext: result.archivedPreviousContext,
          overflowArchived: result.overflowArchived
        }
      };
    }
  );
};
