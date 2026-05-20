import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  detectOllama,
  getOllamaBaseUrl,
  getOllamaOpenAiBaseUrl
} from "./ollama.js";

describe("ollama.ts", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("getOllamaBaseUrl", () => {
    it("returns the default URL when CK_LOCAL_URL is not set", () => {
      delete process.env.CK_LOCAL_URL;
      expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
    });

    it("returns CK_LOCAL_URL when set", () => {
      process.env.CK_LOCAL_URL = "http://myhost:9999";
      expect(getOllamaBaseUrl()).toBe("http://myhost:9999");
    });

    it("strips trailing slashes from CK_LOCAL_URL", () => {
      process.env.CK_LOCAL_URL = "http://myhost:9999///";
      expect(getOllamaBaseUrl()).toBe("http://myhost:9999");
    });

    it("ignores empty CK_LOCAL_URL", () => {
      process.env.CK_LOCAL_URL = "   ";
      expect(getOllamaBaseUrl()).toBe("http://localhost:11434");
    });
  });

  describe("getOllamaOpenAiBaseUrl", () => {
    it("appends /v1 to the base URL", () => {
      delete process.env.CK_LOCAL_URL;
      expect(getOllamaOpenAiBaseUrl()).toBe("http://localhost:11434/v1");
    });
  });

  describe("detectOllama", () => {
    it("returns running with models when Ollama responds", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            models: [
              { name: "gemma3:4b" },
              { name: "llama3.2:latest" }
            ]
          }),
          { status: 200 }
        )
      );

      const result = await detectOllama();
      expect(result.running).toBe(true);
      expect(result.models).toEqual(["gemma3:4b", "llama3.2:latest"]);
    });

    it("returns running with empty models when no models pulled", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ models: [] }), { status: 200 })
      );

      const result = await detectOllama();
      expect(result.running).toBe(true);
      expect(result.models).toEqual([]);
    });

    it("returns not running when fetch fails", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("ECONNREFUSED")
      );

      const result = await detectOllama();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });

    it("returns not running when response is not ok", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("error", { status: 500 })
      );

      const result = await detectOllama();
      expect(result.running).toBe(false);
      expect(result.models).toEqual([]);
    });
  });
});
