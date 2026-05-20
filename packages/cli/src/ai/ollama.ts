import type { Interface as ReadlineInterface } from "node:readline/promises";

export interface OllamaDetectionResult {
  running: boolean;
  models: string[];
}

interface OllamaTagsResponse {
  models?: { name?: string }[];
}

export const RECOMMENDED_MODELS = [
  "gemma3:4b",
  "gemma3:12b",
  "llama3.2",
  "qwen2.5-coder",
  "mistral"
];

export const getOllamaBaseUrl = (): string => {
  const envUrl = process.env.CK_LOCAL_URL;
  if (typeof envUrl === "string" && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, "");
  }

  return "http://localhost:11434";
};

export const getOllamaOpenAiBaseUrl = (): string => `${getOllamaBaseUrl()}/v1`;

export const detectOllama = async (): Promise<OllamaDetectionResult> => {
  const url = `${getOllamaBaseUrl()}/api/tags`;

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      return { running: false, models: [] };
    }

    const body = (await response.json()) as OllamaTagsResponse;
    const models = Array.isArray(body.models)
      ? body.models
          .map((entry) => (typeof entry.name === "string" ? entry.name : ""))
          .filter((name) => name.length > 0)
      : [];

    return { running: true, models };
  } catch {
    return { running: false, models: [] };
  }
};

export const formatOllamaInstallInstructions = (): string =>
  [
    "Ollama is not running or not installed.",
    "",
    "Install Ollama:",
    "  macOS:  brew install ollama",
    "  Linux:  curl -fsSL https://ollama.com/install.sh | sh",
    "  Other:  https://ollama.com/download",
    "",
    "Then start it:",
    "  ollama serve",
    "",
    "Pull a model:",
    ...RECOMMENDED_MODELS.map((model) => `  ollama pull ${model}`),
    "",
    "Re-run `ctx init` after setup."
  ].join("\n");

export const formatNoPulledModelsInstructions = (): string =>
  [
    "Ollama is running but no models are pulled yet.",
    "",
    "Pull a model first:",
    ...RECOMMENDED_MODELS.map((model) => `  ollama pull ${model}`),
    "",
    "Re-run `ctx init` after pulling a model."
  ].join("\n");

export const promptOllamaModelSelection = async (
  models: string[],
  rl: ReadlineInterface
): Promise<string> => {
  process.stdout.write("Available Ollama models:\n");
  for (let i = 0; i < models.length; i += 1) {
    process.stdout.write(`  ${i + 1}) ${models[i]}\n`);
  }

  const answer = await rl.question(`Choose a model [1-${models.length}]: `);
  const index = Number.parseInt(answer.trim(), 10) - 1;

  if (!Number.isInteger(index) || index < 0 || index >= models.length) {
    throw new Error("Invalid model selection.");
  }

  const selected = models[index];
  if (typeof selected !== "string" || selected.length === 0) {
    throw new Error("Invalid model selection.");
  }

  return selected;
};
