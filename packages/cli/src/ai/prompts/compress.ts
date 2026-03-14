export interface CompressPromptInput {
  tokenBudget: number;
  currentLcd: string;
  newSignals: string;
}

export const compressionPromptTemplate = `You are a context compression agent. Your job is to take a verbose Living Context Document (LCD) and compress it to under {TOKEN_BUDGET} tokens without losing any decision-critical information.

Rules:
1. NEVER delete architectural decisions — archive them instead
2. NEVER delete active blockers or in-progress work
3. Merge duplicate entries into single statements
4. Remove filler phrases, keep only facts
5. Summarize "Recently Completed" to 1 line per item
6. Keep "Active Goal" as the single most important current objective
7. Preserve all code conventions exactly — these must never be lost
8. Output ONLY the compressed markdown. No preamble. No explanation.
9. Output an ARCHIVE section at the bottom with anything you removed (prefix with ##ARCHIVE##)

Current LCD:
{CURRENT_LCD}

New signals to incorporate:
{NEW_SIGNALS}`;

export const renderCompressPrompt = (input: CompressPromptInput): string =>
  compressionPromptTemplate
    .replace("{TOKEN_BUDGET}", String(input.tokenBudget))
    .replace("{CURRENT_LCD}", input.currentLcd)
    .replace("{NEW_SIGNALS}", input.newSignals);
