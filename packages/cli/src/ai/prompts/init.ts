export interface InitPromptInput {
  fileTree: string;
  packageJson: string;
  readme: string;
  gitLog: string;
  keyFiles: string;
}

export const initPromptTemplate = `You are analyzing a software project to generate its first Living Context Document (LCD).

You have access to:
- File tree: {FILE_TREE}
- package.json: {PACKAGE_JSON}
- README (if exists): {README}
- Recent git commits (last 30): {GIT_LOG}
- Key source files: {KEY_FILES}

Generate a Living Context Document following this exact structure:
[LCD structure from section 4.1]

Rules:
- Be specific, not generic. "React app using Supabase" not "a web application"
- If you can't determine something with confidence, omit it — do not guess
- Active Goal should be inferred from the most recent commits
- Under 1500 tokens total
- Output ONLY the markdown document`;

export const renderInitPrompt = (input: InitPromptInput): string =>
  initPromptTemplate
    .replace("{FILE_TREE}", input.fileTree)
    .replace("{PACKAGE_JSON}", input.packageJson)
    .replace("{README}", input.readme)
    .replace("{GIT_LOG}", input.gitLog)
    .replace("{KEY_FILES}", input.keyFiles);
