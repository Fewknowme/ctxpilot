import { realpathSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";

import chokidar from "chokidar";

import { runUpdate } from "../commands/update.js";
import { ensureCkStructure, getCkPaths, readCkConfig } from "./lcd.js";

const DEBOUNCE_MS = 30_000;

export interface WatcherOptions {
  since?: string;
}

export interface StartWatchDaemonResult {
  started: boolean;
  pid: number;
  message: string;
}

const parsePid = (raw: string): number | null => {
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }

    return true;
  }
};

const readExistingPid = async (projectRoot: string): Promise<number | null> => {
  const paths = getCkPaths(projectRoot);
  try {
    return parsePid(await readFile(paths.daemonPidPath, "utf8"));
  } catch {
    return null;
  }
};

const clearDaemonPid = async (projectRoot: string): Promise<void> => {
  const paths = getCkPaths(projectRoot);
  try {
    await unlink(paths.daemonPidPath);
  } catch {
    // Ignore missing pid files during shutdown and stale cleanup.
  }
};

const ensureFreshPidFile = async (projectRoot: string): Promise<number | null> => {
  const existingPid = await readExistingPid(projectRoot);
  if (existingPid === null) {
    return null;
  }

  if (isProcessRunning(existingPid)) {
    return existingPid;
  }

  await clearDaemonPid(projectRoot);
  return null;
};

const toRelativePath = (projectRoot: string, targetPath: string): string => {
  const relative = path.relative(projectRoot, targetPath);
  return relative.length > 0 ? relative : ".";
};

const matchesIgnoreRule = (relativePath: string, rule: string): boolean => {
  const normalizedRule = rule.trim();
  if (normalizedRule.length === 0) {
    return false;
  }

  if (normalizedRule.startsWith("*.")) {
    return relativePath.endsWith(normalizedRule.slice(1));
  }

  const normalizedRelative = relativePath.split(path.sep).join("/");
  const normalizedTarget = normalizedRule.split(path.sep).join("/");
  return (
    normalizedRelative === normalizedTarget ||
    normalizedRelative.startsWith(`${normalizedTarget}/`) ||
    normalizedRelative.split("/").includes(normalizedTarget)
  );
};

const isFileWatchIgnored = (
  projectRoot: string,
  targetPath: string,
  ignoreRules: string[]
): boolean => {
  const relativePath = toRelativePath(projectRoot, targetPath);

  if (relativePath === ".") {
    return false;
  }

  if (relativePath === ".git" || relativePath.startsWith(`.git${path.sep}`)) {
    return true;
  }

  // Simplest safe choice: ignore ctxpilot's own output files so updates
  // do not re-trigger themselves. Manual signals are watched explicitly.
  if (relativePath === ".ctxpilot" || relativePath.startsWith(`.ctxpilot${path.sep}`)) {
    return true;
  }

  return ignoreRules.some((rule) => rule !== ".git" && matchesIgnoreRule(relativePath, rule));
};

const createWatcherHandler = (
  options: WatcherOptions,
  onFailure: (message: string) => void
): ((eventPath?: string) => void) => {
  let timeout: NodeJS.Timeout | null = null;
  let isUpdating = false;

  const scheduleUpdate = (): void => {
    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(async () => {
      if (isUpdating) {
        return;
      }

      isUpdating = true;
      try {
        await runUpdate(typeof options.since === "string" ? { since: options.since } : {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onFailure(message);
      } finally {
        isUpdating = false;
      }
    }, DEBOUNCE_MS);
  };

  const handler = (): void => {
    scheduleUpdate();
  };

  Object.defineProperty(handler, "clear", {
    value: (): void => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    }
  });

  return handler;
};

const getEntryScriptPath = (): string => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    throw new Error("Unable to resolve the ctxpilot CLI entrypoint for daemon startup.");
  }

  return realpathSync(entryPath);
};

export const startWatchDaemon = async (
  options: WatcherOptions = {},
  projectRoot = process.cwd()
): Promise<StartWatchDaemonResult> => {
  await ensureCkStructure(projectRoot);
  const runningPid = await ensureFreshPidFile(projectRoot);
  if (runningPid !== null) {
    return {
      started: false,
      pid: runningPid,
      message: `ctxpilot watch daemon is already running. PID ${runningPid}.`
    };
  }

  const entryScript = getEntryScriptPath();
  const args = [entryScript, "watch", "--foreground"];
  if (typeof options.since === "string" && options.since.trim().length > 0) {
    args.push("--since", options.since.trim());
  }

  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    detached: true,
    stdio: "ignore"
  });
  child.unref();

  return {
    started: true,
    pid: child.pid ?? 0,
    message: `ctxpilot watch daemon started. PID ${child.pid ?? "unknown"}.`
  };
};

export const runWatchLoop = async (
  options: WatcherOptions = {},
  projectRoot = process.cwd()
): Promise<void> => {
  await ensureCkStructure(projectRoot);
  const config = await readCkConfig(projectRoot);
  const paths = getCkPaths(projectRoot);

  await writeFile(paths.daemonPidPath, `${process.pid}\n`, "utf8");

  const onFailure = (message: string): void => {
    process.stderr.write(`watch update failed: ${message}\n`);
  };
  const handler = createWatcherHandler(options, onFailure) as ((eventPath?: string) => void) & {
    clear: () => void;
  };

  const fileWatcher = chokidar.watch(projectRoot, {
    persistent: true,
    ignoreInitial: true,
    ignored: (targetPath) => isFileWatchIgnored(projectRoot, targetPath, config.fileIgnore)
  });

  const gitRefsPath = path.join(projectRoot, ".git", "refs", "heads");
  const gitWatcher = chokidar.watch(gitRefsPath, {
    persistent: true,
    ignoreInitial: true
  });

  const signalWatcher = chokidar.watch(paths.signalsPath, {
    persistent: true,
    ignoreInitial: true
  });

  fileWatcher.on("add", handler);
  fileWatcher.on("change", handler);
  fileWatcher.on("unlink", handler);

  gitWatcher.on("add", handler);
  gitWatcher.on("change", handler);
  gitWatcher.on("unlink", handler);

  signalWatcher.on("add", handler);
  signalWatcher.on("change", handler);
  signalWatcher.on("unlink", handler);

  const cleanup = async (): Promise<void> => {
    handler.clear();
    await Promise.all([fileWatcher.close(), gitWatcher.close(), signalWatcher.close()]);
    await clearDaemonPid(projectRoot);
  };

  const shutdown = async (): Promise<void> => {
    await cleanup();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGHUP", shutdown);
};
