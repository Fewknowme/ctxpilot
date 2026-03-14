export interface ExtractPromptInput {
  gitDiff: string;
  newCommits: string;
  modifiedFiles: string;
  manualSignals: string;
}

export const extractionPromptTemplate = `You are extracting context signals from developer activity.

Given the following changes since last context update:
- Git diff: {GIT_DIFF}
- New commits: {NEW_COMMITS}  
- Modified files: {MODIFIED_FILES}
- Manual signals: {MANUAL_SIGNALS}

Extract signals in JSON format:
{
  "decisions": ["decision: rationale"],
  "completed": ["what was finished"],
  "in_progress": ["what's being worked on"],
  "blockers": ["any new blockers"],
  "preference_changes": ["any new conventions observed"]
}

Only extract what you can observe from the actual changes. Do not infer or guess.`;

export const renderExtractPrompt = (input: ExtractPromptInput): string =>
  extractionPromptTemplate
    .replace("{GIT_DIFF}", input.gitDiff)
    .replace("{NEW_COMMITS}", input.newCommits)
    .replace("{MODIFIED_FILES}", input.modifiedFiles)
    .replace("{MANUAL_SIGNALS}", input.manualSignals);
