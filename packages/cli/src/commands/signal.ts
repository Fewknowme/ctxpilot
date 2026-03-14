import { Command } from "commander";

import { appendManualSignal } from "../core/lcd.js";

export const runSignal = async (text: string): Promise<void> => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new Error("Signal text cannot be empty.");
  }

  const signal = await appendManualSignal(trimmed, process.cwd());
  process.stdout.write(`Signal recorded: ${signal.id}\n`);
};

export const registerSignalCommand = (program: Command): void => {
  program
    .command("signal <text>")
    .description("Add a manual signal for the next update")
    .action(async (text: string) => {
      await runSignal(text);
    });
};
