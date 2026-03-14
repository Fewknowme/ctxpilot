import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendManualSignal,
  ensureCkStructure,
  getCkPaths,
  markSignalsProcessed,
  readLcd,
  readSignals,
  writeLcd
} from "./lcd.js";

const tempDirs: string[] = [];

const createTempProject = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ctx-lcd-test-"));
  tempDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(tempDirs.map(async (dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("lcd.ts", () => {
  it("creates .ctxpilot structure from an empty project", async () => {
    const projectRoot = await createTempProject();
    const paths = await ensureCkStructure(projectRoot);

    const context = await readLcd(projectRoot);
    const signals = await readSignals(projectRoot);

    expect(paths.contextPath).toBe(path.join(projectRoot, ".ctxpilot", "context.md"));
    expect(context.exists).toBe(true);
    expect(context.content.length).toBeGreaterThan(0);
    expect(signals).toEqual([]);
  });

  it("archives previous LCD content on write", async () => {
    const projectRoot = await createTempProject();
    await ensureCkStructure(projectRoot);

    await writeLcd({
      projectRoot,
      content: "# First Context\n- one"
    });

    await writeLcd({
      projectRoot,
      content: "# Second Context\n- two"
    });

    const paths = getCkPaths(projectRoot);
    const archiveFiles = await readdir(paths.archiveDir);
    expect(archiveFiles.length).toBeGreaterThan(0);

    const archiveContent = await readFile(path.join(paths.archiveDir, archiveFiles[0] ?? ""), "utf8");
    expect(archiveContent).toContain("First Context");
  });

  it("can skip archiving placeholder content on first real write", async () => {
    const projectRoot = await createTempProject();
    await ensureCkStructure(projectRoot);

    await writeLcd({
      projectRoot,
      content: "# First Real Context\n- one",
      archiveExisting: false
    });

    const paths = getCkPaths(projectRoot);
    const archiveFiles = await readdir(paths.archiveDir);
    expect(archiveFiles).toEqual([]);
  });

  it("appends and marks signals as processed without deleting history", async () => {
    const projectRoot = await createTempProject();
    await ensureCkStructure(projectRoot);

    const signal = await appendManualSignal("use drizzle for edge compatibility", projectRoot);
    const stored = await readSignals(projectRoot);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.processedAt).toBeNull();

    await markSignalsProcessed([signal.id], projectRoot);
    const updated = await readSignals(projectRoot);

    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(signal.id);
    expect(updated[0]?.processedAt).not.toBeNull();
  });
});
