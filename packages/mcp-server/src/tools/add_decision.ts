import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { appendBulletToSection, readCurrentContext } from "../resources/context.js";
import { applyContextUpdate } from "./update_context.js";

export const registerAddDecisionTool = (server: McpServer, projectRoot: string): void => {
  server.registerTool(
    "add_decision",
    {
      description: "Append a decision and rationale to Architecture Decisions",
      inputSchema: {
        decision: z.string().min(1),
        rationale: z.string().min(1)
      }
    },
    async ({ decision, rationale }) => {
      const current = await readCurrentContext(projectRoot);
      const next = appendBulletToSection(
        current,
        "## ⚙️ Architecture Decisions (Active)",
        `${decision}: ${rationale}`
      );

      const result = await applyContextUpdate({
        projectRoot,
        content: next,
        merge: false,
        note: "MCP add_decision"
      });

      return {
        content: [
          {
            type: "text",
            text: `Decision added (${result.tokenCount}/${result.tokenBudget} tokens).`
          }
        ],
        structuredContent: {
          decision,
          rationale,
          tokenCount: result.tokenCount,
          tokenBudget: result.tokenBudget
        }
      };
    }
  );
};
