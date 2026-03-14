import { getEnv, getRequiredApiKey, type AiProvider } from "../config/env.js";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

export interface ClaudeRequest {
  prompt: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export type AiClient = Anthropic | OpenAI;

const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o-mini"
};

export const resolveProvider = (): AiProvider => getEnv().CK_PROVIDER;

export const resolveModel = (explicitModel?: string, provider = resolveProvider()): string => {
  const env = getEnv();

  if (explicitModel && explicitModel.trim().length > 0) {
    const model = explicitModel.trim();
    const oppositeProvider = provider === "anthropic" ? "openai" : "anthropic";

    if (!env.CK_MODEL && model === DEFAULT_MODELS[oppositeProvider]) {
      return DEFAULT_MODELS[provider];
    }

    return model;
  }

  const envModel = env.CK_MODEL;
  if (envModel && envModel.trim().length > 0) {
    return envModel;
  }

  return DEFAULT_MODELS[provider];
};

export const createAnthropicClient = (apiKey?: string): Anthropic => {
  const resolvedApiKey = apiKey ?? getRequiredApiKey("anthropic");
  return new Anthropic({ apiKey: resolvedApiKey });
};

export const createOpenAiClient = (apiKey?: string): OpenAI => {
  const resolvedApiKey = apiKey ?? getRequiredApiKey("openai");
  return new OpenAI({ apiKey: resolvedApiKey });
};

const extractAnthropicText = (response: Anthropic.Messages.Message): string => {
  const parts = response.content
    .filter((item): item is Anthropic.Messages.TextBlock => item.type === "text")
    .map((item) => item.text.trim())
    .filter((item) => item.length > 0);

  return parts.join("\n").trim();
};

const runAnthropicText = async (args: ClaudeRequest, client?: Anthropic): Promise<string> => {
  const anthropic = client ?? createAnthropicClient();
  const request: Anthropic.Messages.MessageCreateParamsNonStreaming = {
    model: resolveModel(args.model, "anthropic"),
    max_tokens: args.maxTokens ?? 1024,
    messages: [
      {
        role: "user",
        content: args.prompt
      }
    ]
  };

  if (typeof args.system === "string") {
    request.system = args.system;
  }

  if (typeof args.temperature === "number") {
    request.temperature = args.temperature;
  }

  const response = await anthropic.messages.create(request);
  const text = extractAnthropicText(response);

  if (text.length === 0) {
    throw new Error("Anthropic returned an empty response.");
  }

  return text;
};

const runOpenAiText = async (args: ClaudeRequest, client?: OpenAI): Promise<string> => {
  const openai = client ?? createOpenAiClient();
  const request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model: resolveModel(args.model, "openai"),
    max_tokens: args.maxTokens ?? 1024,
    messages: [
      ...(typeof args.system === "string"
        ? [
            {
              role: "system" as const,
              content: args.system
            }
          ]
        : []),
      {
        role: "user",
        content: args.prompt
      }
    ]
  };

  if (typeof args.temperature === "number") {
    request.temperature = args.temperature;
  }

  const response = await openai.chat.completions.create(request);

  const text = response.choices
    .map((choice) => choice.message.content ?? "")
    .filter((content) => content.trim().length > 0)
    .join("\n")
    .trim();

  if (text.length === 0) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
};

export const runClaudeText = async (
  args: ClaudeRequest,
  client?: AiClient
): Promise<string> => {
  const provider = resolveProvider();

  if (provider === "openai") {
    return runOpenAiText(args, client as OpenAI | undefined);
  }

  return runAnthropicText(args, client as Anthropic | undefined);
};
