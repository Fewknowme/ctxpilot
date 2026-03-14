import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { readArchiveContent, readArchiveFiles } from "../resources/context.js";

export interface ArchiveMatch {
  file: string;
  score: number;
  excerpt: string;
}

const scoreMatch = (text: string, query: string): number => {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (normalizedQuery.length === 0) {
    return 0;
  }

  let score = 0;
  let index = normalizedText.indexOf(normalizedQuery);
  while (index >= 0) {
    score += 1;
    index = normalizedText.indexOf(normalizedQuery, index + normalizedQuery.length);
  }

  return score;
};

const findExcerpt = (text: string, query: string): string => {
  const normalizedText = text.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  const index = normalizedText.indexOf(normalizedQuery);
  if (index < 0) {
    return text.slice(0, 220).trim();
  }

  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + query.length + 140);
  return text.slice(start, end).trim();
};

export const searchArchive = async (
  projectRoot: string,
  query: string
): Promise<ArchiveMatch[]> => {
  const files = await readArchiveFiles(projectRoot);
  const matches: ArchiveMatch[] = [];

  for (const file of files) {
    const content = await readArchiveContent(projectRoot, file);
    const score = scoreMatch(content, query);
    if (score <= 0) {
      continue;
    }

    matches.push({
      file,
      score,
      excerpt: findExcerpt(content, query)
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, 5);
};

export const registerSearchArchiveTool = (server: McpServer, projectRoot: string): void => {
  server.registerTool(
    "search_archive",
    {
      description: "Keyword search across archived context entries",
      inputSchema: {
        query: z.string().min(1)
      }
    },
    async ({ query }) => {
      const matches = await searchArchive(projectRoot, query);

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No archive matches found."
            }
          ],
          structuredContent: {
            matches: []
          }
        };
      }

      const summary = matches
        .map((match, index) => `${index + 1}. ${match.file} (score: ${match.score})\n${match.excerpt}`)
        .join("\n\n");

      return {
        content: [
          {
            type: "text",
            text: summary
          }
        ],
        structuredContent: {
          matches
        }
      };
    }
  );
};
