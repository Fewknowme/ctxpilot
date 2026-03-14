import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCkStructure, getCkPaths } from "./lcd.js";
import { compressLcd, enforceTokenBudget, splitArchiveSection } from "./compressor.js";

const { runClaudeTextMock } = vi.hoisted(() => ({
  runClaudeTextMock: vi.fn<
    (args: { prompt: string; maxTokens?: number; temperature?: number; model?: string }) => Promise<string>
  >()
}));

vi.mock("../ai/client.js", async () => {
  const actual = await vi.importActual<typeof import("../ai/client.js")>("../ai/client.js");
  return {
    ...actual,
    runClaudeText: runClaudeTextMock
  };
});

const tempDirs: string[] = [];

const createTempProject = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-compressor-test-"));
  tempDirs.push(dir);
  return dir;
};

beforeEach(() => {
  runClaudeTextMock.mockReset();
});

afterEach(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("compressor.ts", () => {
  it("returns within-budget metadata", () => {
    const result = enforceTokenBudget("hello world", 2000);
    expect(result.withinBudget).toBe(true);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("splits archive section correctly", () => {
    const split = splitArchiveSection("# LCD\nBody\n\n##ARCHIVE##\nold content");
    expect(split.compressedMarkdown).toContain("# LCD");
    expect(split.archiveMarkdown).toContain("old content");
  });

  it("no-ops compression when no new signals and under budget", async () => {
    const result = await compressLcd({
      currentLcd: "# Context\n- stable",
      tokenBudget: 2000
    });

    expect(result.retried).toBe(false);
    expect(result.archivePath).toBeNull();
    expect(result.compressedLcd).toContain("stable");
    expect(runClaudeTextMock).not.toHaveBeenCalled();
  });

  it("archives extracted ARCHIVE section", async () => {
    const projectRoot = await createTempProject();
    await ensureCkStructure(projectRoot);

    runClaudeTextMock.mockResolvedValueOnce("# Compact\n- line\n\n##ARCHIVE##\nlegacy decision details");

    const result = await compressLcd({
      projectRoot,
      currentLcd: "# Verbose\n" + "line\n".repeat(1200),
      tokenBudget: 50,
      newSignals: "added a new decision"
    });

    expect(result.archivePath).not.toBeNull();

    const paths = getCkPaths(projectRoot);
    const archiveFiles = await readdir(paths.archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);
    const archiveContent = await readFile(path.join(paths.archiveDir, archiveFiles[0] ?? ""), "utf8");
    expect(archiveContent).toContain("legacy decision details");
  });

  it("throws when retry still exceeds token budget", async () => {
    runClaudeTextMock
      .mockResolvedValueOnce("# still huge\n" + "word ".repeat(5000))
      .mockResolvedValueOnce("# still huge\n" + "word ".repeat(5000));

    await expect(
      compressLcd({
        currentLcd: "# Verbose\n" + "word ".repeat(5000),
        tokenBudget: 20,
        newSignals: "force compression"
      })
    ).rejects.toThrow(/failed to meet token budget/i);
  });
});
