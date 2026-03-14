import { Command } from "commander";

import { readLcd } from "../core/lcd.js";

export interface InjectCommandOptions {
  format?: "markdown" | "xml" | "plaintext";
}

const toPlaintext = (markdown: string): string =>
  markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();

const toXml = (markdown: string): string => {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<ctxpilot>\n  <resource uri="context://project/current">\n${escaped}\n  </resource>\n</ctxpilot>`;
};

export const runInject = async (options: InjectCommandOptions = {}): Promise<void> => {
  const format = options.format ?? "markdown";
  const lcd = await readLcd(process.cwd());
  if (!lcd.exists) {
    throw new Error("No LCD found. Run `ctx init` first.");
  }

  if (format === "markdown") {
    process.stdout.write(`${lcd.content}\n`);
    return;
  }

  if (format === "xml") {
    process.stdout.write(`${toXml(lcd.content)}\n`);
    return;
  }

  process.stdout.write(`${toPlaintext(lcd.content)}\n`);
};

export const registerInjectCommand = (program: Command): void => {
  program
    .command("inject")
    .description("Output current LCD for piping into prompts")
    .option("--format <format>", "markdown|xml|plaintext", "markdown")
    .action(async (options: InjectCommandOptions) => {
      await runInject(options);
    });
};
