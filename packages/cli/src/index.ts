#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { registerBuildCommand } from "./commands/build.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInjectCommand } from "./commands/inject.js";
import { registerServeCommand } from "./commands/serve.js";
import { registerSetupCommand } from "./commands/setup.js";
import { registerShowCommand } from "./commands/show.js";
import { registerSignalCommand } from "./commands/signal.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerWatchCommand } from "./commands/watch.js";

export const createProgram = (): Command => {
  const program = new Command();
  program.name("ctx").description("ctxpilot CLI").version("0.1.1");

  registerInitCommand(program);
  registerBuildCommand(program);
  registerSetupCommand(program);
  registerUpdateCommand(program);
  registerWatchCommand(program);
  registerShowCommand(program);
  registerInjectCommand(program);
  registerServeCommand(program);
  registerSignalCommand(program);

  return program;
};

export const runCli = async (argv: string[] = process.argv): Promise<void> => {
  const program = createProgram();
  await program.parseAsync(argv);
};

const isDirectExecution = (): boolean => {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }

  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectExecution()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`ctxpilot error: ${message}\n`);
    process.exitCode = 1;
  });
}
