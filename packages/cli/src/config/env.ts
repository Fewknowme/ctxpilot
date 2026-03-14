import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { config as loadDotenv, parse as parseDotenv } from "dotenv";
import { z } from "zod";

const providerSchema = z.enum(["anthropic", "openai"]);

export type AiProvider = z.infer<typeof providerSchema>;
export type ProviderSource =
  | "project-env"
  | "project-env-inferred"
  | "shell-env"
  | "shell-env-inferred"
  | "global-env"
  | "global-env-inferred"
  | "project-config"
  | "default";

export interface ProviderResolution {
  provider: AiProvider;
  source: ProviderSource;
}

const optionalTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const optionalPositiveInteger = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string" && value.trim().length === 0) {
    return undefined;
  }

  return Number(value);
}, z.number().int().positive().optional());

const cliEnvSchema = z.object({
  CK_PROVIDER: providerSchema,
  CK_API_KEY: optionalTrimmedString,
  CK_OPENAI_API_KEY: optionalTrimmedString,
  CK_MODEL: optionalTrimmedString,
  CK_TOKEN_BUDGET: optionalPositiveInteger,
  CK_CLOUD_TOKEN: optionalTrimmedString
});

export type CliEnv = z.infer<typeof cliEnvSchema>;

const getProjectEnvPath = (): string => path.join(process.cwd(), ".env");
const getGlobalEnvPath = (): string => path.join(os.homedir(), ".ctxpilot", ".env");
const getProjectConfigPath = (): string => path.join(process.cwd(), ".ctxpilot", "config.json");

const loadEnvFiles = (): void => {
  const envFiles = [getProjectEnvPath(), getGlobalEnvPath()];

  for (const envFile of envFiles) {
    // `override: false` keeps shell-exported values intact while still loading missing keys.
    loadDotenv({ path: envFile, override: false, quiet: true });
  }
};

const readDotenvValue = (filePath: string, key: string): string | undefined => {
  try {
    const parsed = parseDotenv(readFileSync(filePath, "utf8"));
    const value = parsed[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  } catch {
    return undefined;
  }
};

const readProviderFromProjectConfig = (): AiProvider | undefined => {
  try {
    const raw = readFileSync(getProjectConfigPath(), "utf8");
    const parsed = JSON.parse(raw) as { provider?: unknown };
    const result = providerSchema.safeParse(parsed.provider);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
};

const inferProviderFromKeys = (keys: {
  anthropicKey: string | undefined;
  openAiKey: string | undefined;
}): AiProvider | undefined => {
  if (keys.anthropicKey && !keys.openAiKey) {
    return "anthropic";
  }

  if (keys.openAiKey && !keys.anthropicKey) {
    return "openai";
  }

  return undefined;
};

const resolveShellValue = (
  key: string,
  projectEnvValue: string | undefined,
  globalEnvValue: string | undefined
): string | undefined => {
  const shellValue = process.env[key];
  if (typeof shellValue !== "string" || shellValue.trim().length === 0) {
    return undefined;
  }

  const normalized = shellValue.trim();
  if (projectEnvValue === normalized || globalEnvValue === normalized) {
    return undefined;
  }

  return normalized;
};

export const resolveProviderResolution = (sources: {
  projectEnvProvider: string | undefined;
  projectEnvAnthropicKey: string | undefined;
  projectEnvOpenAiKey: string | undefined;
  shellProvider: string | undefined;
  shellAnthropicKey: string | undefined;
  shellOpenAiKey: string | undefined;
  globalEnvProvider: string | undefined;
  globalEnvAnthropicKey: string | undefined;
  globalEnvOpenAiKey: string | undefined;
  projectConfigProvider: AiProvider | undefined;
}): ProviderResolution => {
  const projectEnv = providerSchema.safeParse(sources.projectEnvProvider);
  if (projectEnv.success) {
    return {
      provider: projectEnv.data,
      source: "project-env"
    };
  }

  const shellEnv = providerSchema.safeParse(sources.shellProvider);
  if (shellEnv.success) {
    return {
      provider: shellEnv.data,
      source: "shell-env"
    };
  }

  const globalEnv = providerSchema.safeParse(sources.globalEnvProvider);
  if (globalEnv.success) {
    return {
      provider: globalEnv.data,
      source: "global-env"
    };
  }

  const projectEnvInference = inferProviderFromKeys({
    anthropicKey: sources.projectEnvAnthropicKey,
    openAiKey: sources.projectEnvOpenAiKey
  });
  if (projectEnvInference) {
    return {
      provider: projectEnvInference,
      source: "project-env-inferred"
    };
  }

  const shellEnvInference = inferProviderFromKeys({
    anthropicKey: sources.shellAnthropicKey,
    openAiKey: sources.shellOpenAiKey
  });
  if (shellEnvInference) {
    return {
      provider: shellEnvInference,
      source: "shell-env-inferred"
    };
  }

  const globalEnvInference = inferProviderFromKeys({
    anthropicKey: sources.globalEnvAnthropicKey,
    openAiKey: sources.globalEnvOpenAiKey
  });
  if (globalEnvInference) {
    return {
      provider: globalEnvInference,
      source: "global-env-inferred"
    };
  }

  if (sources.projectConfigProvider) {
    return {
      provider: sources.projectConfigProvider,
      source: "project-config"
    };
  }

  return {
    provider: "anthropic",
    source: "default"
  };
};

export const getProviderResolution = (): ProviderResolution =>
  resolveProviderResolution((() => {
    const projectEnvProvider = readDotenvValue(getProjectEnvPath(), "CK_PROVIDER");
    const projectEnvAnthropicKey = readDotenvValue(getProjectEnvPath(), "CK_API_KEY");
    const projectEnvOpenAiKey = readDotenvValue(getProjectEnvPath(), "CK_OPENAI_API_KEY");
    const globalEnvProvider = readDotenvValue(getGlobalEnvPath(), "CK_PROVIDER");
    const globalEnvAnthropicKey = readDotenvValue(getGlobalEnvPath(), "CK_API_KEY");
    const globalEnvOpenAiKey = readDotenvValue(getGlobalEnvPath(), "CK_OPENAI_API_KEY");

    return {
      projectEnvProvider,
      projectEnvAnthropicKey,
      projectEnvOpenAiKey,
      shellProvider: resolveShellValue("CK_PROVIDER", projectEnvProvider, globalEnvProvider),
      shellAnthropicKey: resolveShellValue("CK_API_KEY", projectEnvAnthropicKey, globalEnvAnthropicKey),
      shellOpenAiKey: resolveShellValue(
        "CK_OPENAI_API_KEY",
        projectEnvOpenAiKey,
        globalEnvOpenAiKey
      ),
      globalEnvProvider,
      globalEnvAnthropicKey,
      globalEnvOpenAiKey,
      projectConfigProvider: readProviderFromProjectConfig()
    };
  })());

export const formatProviderSource = (source: ProviderSource): string => {
  switch (source) {
    case "project-env":
      return "project .env";
    case "project-env-inferred":
      return "project .env (inferred)";
    case "shell-env":
      return "shell env";
    case "shell-env-inferred":
      return "shell env (inferred)";
    case "global-env":
      return "~/.ctxpilot/.env";
    case "global-env-inferred":
      return "~/.ctxpilot/.env (inferred)";
    case "project-config":
      return ".ctxpilot/config.json";
    case "default":
      return "default";
  }
};

const parseEnv = (): CliEnv => {
  loadEnvFiles();
  const providerResolution = getProviderResolution();

  const parsedEnv = cliEnvSchema.safeParse({
    CK_PROVIDER: providerResolution.provider,
    CK_API_KEY: process.env.CK_API_KEY,
    CK_OPENAI_API_KEY: process.env.CK_OPENAI_API_KEY,
    CK_MODEL: process.env.CK_MODEL,
    CK_TOKEN_BUDGET: process.env.CK_TOKEN_BUDGET,
    CK_CLOUD_TOKEN: process.env.CK_CLOUD_TOKEN
  });

  if (parsedEnv.success) {
    return parsedEnv.data;
  }

  const details = parsedEnv.error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");

  throw new Error(`Invalid ctxpilot environment variables.\n${details}`);
};

export const getEnv = (): CliEnv => parseEnv();

export const getRequiredApiKey = (provider: AiProvider = getEnv().CK_PROVIDER): string => {
  const env = getEnv();
  const projectEnvPath = getProjectEnvPath();
  const globalEnvPath = getGlobalEnvPath();

  if (provider === "openai") {
    if (env.CK_OPENAI_API_KEY) {
      return env.CK_OPENAI_API_KEY;
    }

    throw new Error(
      [
        "CK_OPENAI_API_KEY is missing for provider=openai.",
        `Add CK_OPENAI_API_KEY=your_key_here to ${projectEnvPath},`,
        `or add it to ${globalEnvPath},`,
        "or export CK_OPENAI_API_KEY in your shell before running ctxpilot."
      ].join("\n")
    );
  }

  if (env.CK_API_KEY) {
    return env.CK_API_KEY;
  }

  throw new Error(
    [
      "CK_API_KEY is missing for provider=anthropic.",
      `Add CK_API_KEY=your_key_here to ${projectEnvPath},`,
      `or add it to ${globalEnvPath},`,
      "or export CK_API_KEY in your shell before running ctxpilot."
    ].join("\n")
  );
};
