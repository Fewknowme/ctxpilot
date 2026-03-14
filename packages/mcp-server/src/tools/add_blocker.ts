import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { appendBulletToSection, readCurrentContext } from "../resources/context.js";
import { applyContextUpdate } from "./update_context.js";

export const registerAddBlockerTool = (server: McpServer, projectRoot: string): void => {
  server.registerTool(
    "add_blocker",
    {
      description: "Append a blocker to Known Issues / Blockers",
      inputSchema: {
        description: z.string().min(1)
      }
    },
    async ({ description }) => {
      const current = await readCurrentContext(projectRoot);
      const next = appendBulletToSection(current, "## 🐛 Known Issues / Blockers", description);

      const result = await applyContextUpdate({
        projectRoot,
        content: next,
        merge: false,
        note: "MCP add_blocker"
      });

      return {
        content: [
          {
            type: "text",
            text: `Blocker added (${result.tokenCount}/${result.tokenBudget} tokens).`
          }
        ],
        structuredContent: {
          description,
          tokenCount: result.tokenCount,
          tokenBudget: result.tokenBudget
        }
      };
    }
  );
};
