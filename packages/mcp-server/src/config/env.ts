import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const providerSchema = z.enum(["anthropic", "openai"]);

export type AiProvider = z.infer<typeof providerSchema>;

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

const mcpEnvSchema = z.object({
  CK_PROVIDER: providerSchema,
  CK_API_KEY: optionalTrimmedString,
  CK_OPENAI_API_KEY: optionalTrimmedString,
  CK_MODEL: optionalTrimmedString,
  CK_TOKEN_BUDGET: optionalPositiveInteger,
  CK_CLOUD_TOKEN: optionalTrimmedString
});

export type McpEnv = z.infer<typeof mcpEnvSchema>;

const loadEnvFiles = (): void => {
  const envFiles = [path.join(process.cwd(), ".env"), path.join(os.homedir(), ".ctxpilot", ".env")];

  for (const envFile of envFiles) {
    loadDotenv({ path: envFile, override: false, quiet: true });
  }
};

const readProviderFromProjectConfig = (): AiProvider | undefined => {
  const configPath = path.join(process.cwd(), ".ctxpilot", "config.json");

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as { provider?: unknown };
    const result = providerSchema.safeParse(parsed.provider);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
};

const parseEnv = (): McpEnv => {
  loadEnvFiles();

  const parsedEnv = mcpEnvSchema.safeParse({
    CK_PROVIDER: process.env.CK_PROVIDER ?? readProviderFromProjectConfig() ?? "anthropic",
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

  throw new Error(`Invalid ctxpilot MCP environment variables.\n${details}`);
};

export const getEnv = (): McpEnv => parseEnv();
