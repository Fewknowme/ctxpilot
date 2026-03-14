import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { readCurrentContext } from "../resources/context.js";

export const registerGetContextTool = (server: McpServer, projectRoot: string): void => {
  server.registerTool(
    "get_context",
    {
      description: "Return the full current Living Context Document"
    },
    async () => {
      const context = await readCurrentContext(projectRoot);
      return {
        content: [
          {
            type: "text",
            text: context
          }
        ],
        structuredContent: {
          context
        }
      };
    }
  );
};
