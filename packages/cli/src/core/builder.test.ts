import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureCkStructure, getCkPaths } from "./lcd.js";
import { extractSignalsFromChanges } from "./builder.js";

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
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-builder-test-"));
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

describe("builder.ts", () => {
  it("repairs trailing commas without corrupting URLs inside strings", async () => {
    runClaudeTextMock.mockResolvedValueOnce(`{
      "decisions": ["Use https://example.com/docs"],
      "completed": [],
      "in_progress": [],
      "blockers": [],
      "preference_changes": [],
    }`);

    const result = await extractSignalsFromChanges({
      gitDiff: "diff --git a/file.ts b/file.ts",
      newCommits: "",
      modifiedFiles: ["file.ts"],
      manualSignals: []
    });

    expect(result.decisions).toEqual(["Use https://example.com/docs"]);
    expect(runClaudeTextMock).toHaveBeenCalledTimes(1);
  });

  it("archives the first malformed response when the parse retry fails", async () => {
    const projectRoot = await createTempProject();
    await ensureCkStructure(projectRoot);
    runClaudeTextMock
      .mockResolvedValueOnce("not json")
      .mockRejectedValueOnce(new Error("local model unavailable"));

    const result = await extractSignalsFromChanges({
      projectRoot,
      gitDiff: "diff --git a/file.ts b/file.ts",
      newCommits: "",
      modifiedFiles: ["file.ts"],
      manualSignals: []
    });

    expect(result).toEqual({
      decisions: [],
      completed: [],
      in_progress: [],
      blockers: [],
      preference_changes: []
    });

    const paths = getCkPaths(projectRoot);
    const archiveFiles = await readdir(paths.archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);
    const archiveContent = await readFile(path.join(paths.archiveDir, archiveFiles[0] ?? ""), "utf8");
    expect(archiveContent).toContain("not json");
    expect(archiveContent).toContain("local model unavailable");
  });
});
