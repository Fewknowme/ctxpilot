import { describe, expect, it } from "vitest";

import { resolveProviderResolution } from "./env.js";

describe("env provider resolution", () => {
  it("prefers project .env over shell, global, and config providers", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: "openai",
      projectEnvAnthropicKey: undefined,
      projectEnvOpenAiKey: undefined,
      shellProvider: "anthropic",
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: "anthropic",
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: "anthropic"
    });

    expect(resolution).toEqual({
      provider: "openai",
      source: "project-env"
    });
  });

  it("falls back to project config when no env source exists", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: undefined,
      projectEnvOpenAiKey: undefined,
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: "openai"
    });

    expect(resolution).toEqual({
      provider: "openai",
      source: "project-config"
    });
  });

  it("uses the default provider only when nothing explicit is configured", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: undefined,
      projectEnvOpenAiKey: undefined,
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: undefined
    });

    expect(resolution).toEqual({
      provider: "anthropic",
      source: "default"
    });
  });

  it("infers anthropic from a project .env API key when CK_PROVIDER is missing", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: "anthropic-key",
      projectEnvOpenAiKey: undefined,
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: undefined
    });

    expect(resolution).toEqual({
      provider: "anthropic",
      source: "project-env-inferred"
    });
  });

  it("infers openai from a project .env API key when CK_PROVIDER is missing", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: undefined,
      projectEnvOpenAiKey: "openai-key",
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: undefined
    });

    expect(resolution).toEqual({
      provider: "openai",
      source: "project-env-inferred"
    });
  });

  it("keeps provider unresolved when both provider keys are present without CK_PROVIDER", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: "anthropic-key",
      projectEnvOpenAiKey: "openai-key",
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: undefined
    });

    expect(resolution).toEqual({
      provider: "anthropic",
      source: "default"
    });
  });

  it("still falls back to project config when env keys are ambiguous", () => {
    const resolution = resolveProviderResolution({
      projectEnvProvider: undefined,
      projectEnvAnthropicKey: "anthropic-key",
      projectEnvOpenAiKey: "openai-key",
      shellProvider: undefined,
      shellAnthropicKey: undefined,
      shellOpenAiKey: undefined,
      globalEnvProvider: undefined,
      globalEnvAnthropicKey: undefined,
      globalEnvOpenAiKey: undefined,
      projectConfigProvider: "openai"
    });

    expect(resolution).toEqual({
      provider: "openai",
      source: "project-config"
    });
  });
});
