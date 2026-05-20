import type OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runClaudeText } from "./client.js";

describe("client.ts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.CK_PROVIDER = "local";
    delete process.env.CK_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("requires an explicit or configured model for the local provider", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "ok" } }]
    });
    const client = {
      chat: {
        completions: {
          create
        }
      }
    } as unknown as OpenAI;

    await expect(runClaudeText({ prompt: "hello" }, client)).rejects.toThrow(
      /No model configured for local provider/
    );
    expect(create).not.toHaveBeenCalled();
  });
});
