import { countTokens as anthropicCountTokens } from "@anthropic-ai/tokenizer";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";

import { runClaudeText } from "../ai/client.js";
import { renderCompressPrompt } from "../ai/prompts/compress.js";
import { archiveLcdChunk } from "./lcd.js";
import type { ArchiveChunkArgs } from "./lcd.js";

export interface SignalPayload {
  decisions: string[];
  completed: string[];
  in_progress: string[];
  blockers: string[];
  preference_changes: string[];
}

export interface CompressionRequest {
  projectRoot?: string;
  currentLcd: string;
  newSignals?: string | SignalPayload;
  tokenBudget?: number;
  model?: string;
  client?: Anthropic | OpenAI;
}

export interface BudgetResult {
  withinBudget: boolean;
  tokens: number;
  budget: number;
}

export interface ArchiveSplit {
  compressedMarkdown: string;
  archiveMarkdown: string;
}

export interface CompressionResult {
  compressedLcd: string;
  beforeTokens: number;
  afterTokens: number;
  retried: boolean;
  archivePath: string | null;
}

const DEFAULT_TOKEN_BUDGET = 2000;
const ARCHIVE_MARKER = "##ARCHIVE##";

const normalizeSignals = (signals?: string | SignalPayload): string => {
  if (!signals) {
    return "None";
  }

  if (typeof signals === "string") {
    const trimmed = signals.trim();
    return trimmed.length > 0 ? trimmed : "None";
  }

  return JSON.stringify(signals, null, 2);
};

const countTokensSafe = (text: string): number => {
  try {
    return anthropicCountTokens(text);
  } catch {
    // Masterplan requires a fallback if tokenizer API is unavailable.
    return Math.ceil(text.length / 4);
  }
};

export const enforceTokenBudget = (
  content: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET
): BudgetResult => {
  const tokens = countTokensSafe(content);
  return {
    withinBudget: tokens <= tokenBudget,
    tokens,
    budget: tokenBudget
  };
};

export const splitArchiveSection = (content: string): ArchiveSplit => {
  const markerIndex = content.indexOf(ARCHIVE_MARKER);
  if (markerIndex < 0) {
    return {
      compressedMarkdown: content.trim(),
      archiveMarkdown: ""
    };
  }

  const compressedMarkdown = content.slice(0, markerIndex).trim();
  const archiveMarkdown = content.slice(markerIndex + ARCHIVE_MARKER.length).trim();

  return {
    compressedMarkdown,
    archiveMarkdown
  };
};

const runCompressionPass = async (
  request: CompressionRequest,
  currentLcd: string,
  newSignals: string,
  additionalInstruction?: string
): Promise<ArchiveSplit> => {
  const prompt = renderCompressPrompt({
    tokenBudget: request.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
    currentLcd,
    newSignals:
      typeof additionalInstruction === "string"
        ? `${newSignals}\n\n${additionalInstruction}`
        : newSignals
  });

  const aiRequest = {
    prompt,
    maxTokens: 2048,
    temperature: 0.2
  };
  const output = await runClaudeText(
    typeof request.model === "string"
      ? {
          ...aiRequest,
          model: request.model
        }
      : aiRequest,
    request.client
  );

  return splitArchiveSection(output);
};

const countNonEmptyLines = (content: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const line of content.split("\n")) {
    const normalized = line.trimEnd();
    if (normalized.trim().length === 0) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return counts;
};

const getForcedArchiveLines = (
  inputLcd: string,
  outputLcd: string,
  archiveMarkdown: string
): string => {
  const inputCounts = countNonEmptyLines(inputLcd);
  const outputCounts = countNonEmptyLines(outputLcd);
  const archivedCounts = countNonEmptyLines(archiveMarkdown);
  const missingLines: string[] = [];

  for (const [line, inputCount] of inputCounts.entries()) {
    const preservedCount = (outputCounts.get(line) ?? 0) + (archivedCounts.get(line) ?? 0);
    const missingCount = inputCount - preservedCount;
    if (missingCount <= 0) {
      continue;
    }

    for (let index = 0; index < missingCount; index += 1) {
      missingLines.push(line);
    }
  }

  return missingLines.join("\n");
};

const archiveIfNeeded = async (
  request: CompressionRequest,
  archiveMarkdown: string,
  note: string
): Promise<string | null> => {
  if (archiveMarkdown.trim().length === 0) {
    return null;
  }

  const archiveArgs: ArchiveChunkArgs = {
    chunk: archiveMarkdown,
    note
  };
  if (typeof request.projectRoot === "string") {
    archiveArgs.projectRoot = request.projectRoot;
  }

  return archiveLcdChunk(archiveArgs);
};

const archiveDroppedInputLines = async (
  request: CompressionRequest,
  inputLcd: string,
  outputLcd: string,
  archiveMarkdown: string
): Promise<string | null> => {
  const forcedArchiveMarkdown = getForcedArchiveLines(inputLcd, outputLcd, archiveMarkdown);
  if (forcedArchiveMarkdown.trim().length === 0) {
    return null;
  }

  return archiveIfNeeded(
    request,
    forcedArchiveMarkdown,
    "Forced archive of LCD lines omitted from compression output"
  );
};

export const compressLcd = async (request: CompressionRequest): Promise<CompressionResult> => {
  const budget = request.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const signals = normalizeSignals(request.newSignals);
  const before = enforceTokenBudget(request.currentLcd, budget);

  if (before.withinBudget && signals === "None") {
    return {
      compressedLcd: request.currentLcd,
      beforeTokens: before.tokens,
      afterTokens: before.tokens,
      retried: false,
      archivePath: null
    };
  }

  const firstPass = await runCompressionPass(request, request.currentLcd, signals);
  const archivePath = await archiveIfNeeded(
    request,
    firstPass.archiveMarkdown,
    "Content removed during LCD compression"
  );

  const firstBudgetCheck = enforceTokenBudget(firstPass.compressedMarkdown, budget);
  if (firstBudgetCheck.withinBudget) {
    const forcedArchivePath = await archiveDroppedInputLines(
      request,
      request.currentLcd,
      firstPass.compressedMarkdown,
      firstPass.archiveMarkdown
    );
    return {
      compressedLcd: firstPass.compressedMarkdown,
      beforeTokens: before.tokens,
      afterTokens: firstBudgetCheck.tokens,
      retried: false,
      archivePath: forcedArchivePath ?? archivePath
    };
  }

  const secondPass = await runCompressionPass(
    request,
    firstPass.compressedMarkdown,
    "None",
    "Retry: aggressively condense wording while preserving all decisions, blockers, in-progress work, and conventions."
  );
  const secondArchivePath = await archiveIfNeeded(
    request,
    secondPass.archiveMarkdown,
    "Content removed during compression retry"
  );
  const secondBudgetCheck = enforceTokenBudget(secondPass.compressedMarkdown, budget);

  if (!secondBudgetCheck.withinBudget) {
    throw new Error(
      `Compression failed to meet token budget (${secondBudgetCheck.tokens}/${budget}) after retry.`
    );
  }

  const forcedArchivePath = await archiveDroppedInputLines(
    request,
    request.currentLcd,
    secondPass.compressedMarkdown,
    [firstPass.archiveMarkdown, secondPass.archiveMarkdown].filter((chunk) => chunk.trim().length > 0).join("\n\n")
  );

  return {
    compressedLcd: secondPass.compressedMarkdown,
    beforeTokens: before.tokens,
    afterTokens: secondBudgetCheck.tokens,
    retried: true,
    archivePath: forcedArchivePath ?? secondArchivePath ?? archivePath
  };
};
