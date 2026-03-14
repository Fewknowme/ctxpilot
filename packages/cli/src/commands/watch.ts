import { Command, Option } from "commander";

export interface WatchCommandOptions {
  since?: string;
  foreground?: boolean;
}

import { runWatchLoop, startWatchDaemon } from "../core/watcher.js";

export const registerWatchCommand = (program: Command): void => {
  const foregroundOption = new Option("--foreground").hideHelp();
  program
    .command("watch")
    .description("Watch project changes and run incremental context updates")
    .option("--since <timeframe>", "Override incremental window")
    .addOption(foregroundOption)
    .action(async (options: WatchCommandOptions) => {
      if (options.foreground) {
        await runWatchLoop(options);
        return;
      }

      const result = await startWatchDaemon(options);
      process.stdout.write(`${result.message}\n`);
    });
};
