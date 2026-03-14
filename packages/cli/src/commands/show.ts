import { Command } from "commander";

import { enforceTokenBudget } from "../core/compressor.js";
import { readCkConfig, readLcd } from "../core/lcd.js";

export interface ShowCommandOptions {
  raw?: boolean;
  json?: boolean;
}

export const runShow = async (options: ShowCommandOptions = {}): Promise<void> => {
  const root = process.cwd();
  const lcd = await readLcd(root);
  if (!lcd.exists) {
    throw new Error("No LCD found. Run `ctx init` first.");
  }

  const config = await readCkConfig(root);
  const tokenInfo = enforceTokenBudget(lcd.content, config.tokenBudget);

  if (options.json) {
    const payload = {
      path: lcd.path,
      version: config.version,
      lastUpdated: config.lastUpdated,
      tokenCount: tokenInfo.tokens,
      tokenBudget: tokenInfo.budget,
      content: lcd.content
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (options.raw) {
    process.stdout.write(`${lcd.content}\n`);
    return;
  }

  process.stdout.write("ctxpilot LCD\n");
  process.stdout.write(`Version: ${config.version}\n`);
  process.stdout.write(`Last updated: ${config.lastUpdated ?? "unknown"}\n`);
  process.stdout.write(`Tokens: ${tokenInfo.tokens}/${tokenInfo.budget}\n\n`);
  process.stdout.write(`${lcd.content}\n`);
};

export const registerShowCommand = (program: Command): void => {
  program
    .command("show")
    .description("Print the current Living Context Document")
    .option("--raw", "Output raw markdown")
    .option("--json", "Output JSON payload")
    .action(async (options: ShowCommandOptions) => {
      await runShow(options);
    });
};
