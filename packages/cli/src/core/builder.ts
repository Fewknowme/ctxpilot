import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import { z } from "zod";

import { runClaudeText } from "../ai/client.js";
import { renderCompressPrompt } from "../ai/prompts/compress.js";
import { renderExtractPrompt } from "../ai/prompts/extract.js";
import { archiveLcdChunk } from "./lcd.js";
import type { ArchiveChunkArgs } from "./lcd.js";

const extractedSignalsSchema = z.object({
  decisions: z.array(z.string()),
  completed: z.array(z.string()),
  in_progress: z.array(z.string()),
  blockers: z.array(z.string()),
  preference_changes: z.array(z.string())
});

export type ExtractedSignals = z.infer<typeof extractedSignalsSchema>;

export interface ExtractionRequest {
  projectRoot?: string;
  gitDiff: string;
  newCommits: string;
  modifiedFiles: string[];
  manualSignals: string[];
  model?: string;
  client?: Anthropic | OpenAI;
}

export interface MergeLcdRequest {
  projectRoot?: string;
  currentLcd: string;
  signals: ExtractedSignals;
  tokenBudget: number;
  model?: string;
  client?: Anthropic | OpenAI;
}

const EMPTY_SIGNALS: ExtractedSignals = {
  decisions: [],
  completed: [],
  in_progress: [],
  blockers: [],
  preference_changes: []
};

const findJsonCandidate = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    return fenced[1].trim();
  }

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1).trim();
  }

  return raw.trim();
};

const stripJsonLineComments = (raw: string): string => {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";
    const next = raw[index + 1];

    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }

    if (inString) {
      repaired += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      repaired += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (index < raw.length && raw[index] !== "\n") {
        index += 1;
      }
      if (index < raw.length) {
        repaired += "\n";
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
};

const removeTrailingJsonCommas = (raw: string): string => {
  let repaired = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index] ?? "";

    if (escaped) {
      repaired += char;
      escaped = false;
      continue;
    }

    if (inString) {
      repaired += char;
      if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      repaired += char;
      continue;
    }

    if (char === ",") {
      let lookahead = index + 1;
      while (/\s/.test(raw[lookahead] ?? "")) {
        lookahead += 1;
      }
      if (raw[lookahead] === "}" || raw[lookahead] === "]") {
        continue;
      }
    }

    repaired += char;
  }

  return repaired;
};

const repairJson = (raw: string): string => {
  const candidate = stripJsonLineComments(findJsonCandidate(raw));
  return removeTrailingJsonCommas(candidate);
};

const parseSignals = (raw: string): ExtractedSignals | null => {
  const jsonCandidate = findJsonCandidate(raw);
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    const validated = extractedSignalsSchema.safeParse(parsed);
    if (validated.success) {
      return validated.data;
    }
  } catch { /* fall through to repair */ }

  try {
    const repaired = repairJson(raw);
    const parsed = JSON.parse(repaired) as unknown;
    const validated = extractedSignalsSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};

const normalizeSignalsForMerge = (signals: ExtractedSignals): string => {
  return JSON.stringify(signals, null, 2);
};

const formatErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return String(error);
};

const archiveExtractionFailure = async (
  request: ExtractionRequest,
  raw: string,
  retryRaw?: string
): Promise<void> => {
  const archiveArgs: ArchiveChunkArgs = {
    chunk: [
      "--- First attempt ---",
      raw,
      ...(typeof retryRaw === "string" ? ["", "--- Retry attempt ---", retryRaw] : [])
    ].join("\n"),
    note: "Signal extraction parse failure payload"
  };
  if (typeof request.projectRoot === "string") {
    archiveArgs.projectRoot = request.projectRoot;
  }
  await archiveLcdChunk(archiveArgs);
};

export const extractSignalsFromChanges = async (
  request: ExtractionRequest
): Promise<ExtractedSignals> => {
  const prompt = renderExtractPrompt({
    gitDiff: request.gitDiff,
    newCommits: request.newCommits,
    modifiedFiles: request.modifiedFiles.join("\n"),
    manualSignals: request.manualSignals.join("\n")
  });

  const aiRequest = {
    prompt,
    maxTokens: 1024,
    temperature: 0
  };
  const raw = await runClaudeText(
    typeof request.model === "string"
      ? {
          ...aiRequest,
          model: request.model
        }
      : aiRequest,
    request.client
  );

  const parsed = parseSignals(raw);
  if (parsed) {
    return parsed;
  }

  const retryRequest = {
    ...aiRequest,
    system: "You MUST respond with valid JSON only. No markdown fences, no comments, no trailing commas.",
    prompt
  };
  let retryRaw: string;
  try {
    retryRaw = await runClaudeText(
      typeof request.model === "string"
        ? { ...retryRequest, model: request.model }
        : retryRequest,
      request.client
    );
  } catch (error) {
    await archiveExtractionFailure(
      request,
      raw,
      `Retry failed before returning parseable output: ${formatErrorMessage(error)}`
    );
    return { ...EMPTY_SIGNALS };
  }

  const retryParsed = parseSignals(retryRaw);
  if (retryParsed) {
    return retryParsed;
  }

  await archiveExtractionFailure(request, raw, retryRaw);

  return { ...EMPTY_SIGNALS };
};

export const mergeSignalsIntoLcd = async (
  request: MergeLcdRequest
): Promise<string> => {
  const prompt = `${renderCompressPrompt({
    tokenBudget: request.tokenBudget,
    currentLcd: request.currentLcd,
    newSignals: normalizeSignalsForMerge(request.signals)
  })}\n\nAdditional instruction: incorporate these new signals into the LCD naturally, updating existing sections rather than just appending. Rewrite the full LCD so it reads like one coherent document. Keep the same overall section structure and output only markdown.`;

  const aiRequest = {
    prompt,
    maxTokens: 2048,
    temperature: 0.2
  };
  const rewritten = await runClaudeText(
    typeof request.model === "string"
      ? {
          ...aiRequest,
          model: request.model
        }
      : aiRequest,
    request.client
  );

  return rewritten.trim();
};

export const getEmptySignals = (): ExtractedSignals => ({
  ...EMPTY_SIGNALS,
  decisions: [],
  completed: [],
  in_progress: [],
  blockers: [],
  preference_changes: []
});
