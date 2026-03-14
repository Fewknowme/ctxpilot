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

const parseSignals = (raw: string): ExtractedSignals | null => {
  const jsonCandidate = findJsonCandidate(raw);
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    const validated = extractedSignalsSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
};

const normalizeSignalsForMerge = (signals: ExtractedSignals): string => {
  return JSON.stringify(signals, null, 2);
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

  const archiveArgs: ArchiveChunkArgs = {
    chunk: raw,
    note: "Signal extraction parse failure payload"
  };
  if (typeof request.projectRoot === "string") {
    archiveArgs.projectRoot = request.projectRoot;
  }
  await archiveLcdChunk(archiveArgs);

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
