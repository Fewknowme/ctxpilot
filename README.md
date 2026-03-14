# ctxpilot

[![CI](https://github.com/fewknowme/ctxpilot/actions/workflows/ci.yml/badge.svg)](https://github.com/fewknowme/ctxpilot/actions/workflows/ci.yml)

ctxpilot is a CLI and MCP server that keeps a living project summary in `.ctxpilot/context.md`. It updates that summary from your repo and gives the same starting context to Claude Code, Codex CLI, Cursor, and Windsurf.

## Demo story

Open a fresh Codex session and ask about a cart bug. With ctxpilot set up, Codex can answer about `cart.ts` line numbers cold because it already read the LCD and has the project MCP tools available.

## Install

```bash
npm install -g @ctxpilot/ctxpilot
```

Set `CK_PROVIDER` and the matching API key in a project `.env` or `~/.ctxpilot/.env` before `ctx init`.

One-off run:

```bash
npx @ctxpilot/ctxpilot init
```

## Quickstart

```bash
ctx init
ctx setup
ctx watch
```

`ctx init` creates `.ctxpilot/` and the first LCD. `ctx setup` wires MCP and native instruction files. `ctx watch` starts the background updater.

## Command reference

| Command | What it does | Notes |
| --- | --- | --- |
| `ctx init` | Create `.ctxpilot/` and build the first LCD | Prompts for provider, goal, stack, and preferences |
| `ctx setup` | Write MCP config for installed clients and project instruction files | Supports Claude Code, Codex CLI, Cursor, and Windsurf |
| `ctx watch [--since <timeframe>]` | Start the background watcher | Runs `ctx update` after changes |
| `ctx update [--since <timeframe>]` | Run one incremental update now | `--since` accepts `2h`, `1d`, `1w`, or an ISO date |
| `ctx build` | Rebuild the LCD from the current repo state | Archives the previous LCD |
| `ctx show [--raw] [--json]` | Print the current LCD | `--raw` prints markdown, `--json` prints metadata and content |
| `ctx inject --format <markdown|xml|plaintext>` | Output the current LCD for prompts | Default format is `markdown` |
| `ctx signal <text>` | Add a manual signal for the next update | Writes to `.ctxpilot/signals.json` |
| `ctx serve` | Start the MCP server for the current project | Used by MCP client configs |

## How auto-update works

- `ctx watch` starts a daemon and writes `.ctxpilot/daemon.pid`.
- The daemon watches project files, `.git/refs/heads`, and `.ctxpilot/signals.json`.
- Changes are debounced for 30 seconds, then `ctx update` runs.
- `.ctxpilot/` output files are ignored so updates do not trigger themselves.

## MCP setup

Run `ctx setup` inside the project you want to expose. It writes a project MCP server name like `ctx-my-project`.

| Client | Home config written by `ctx setup` | Project file written by `ctx setup` |
| --- | --- | --- |
| Claude Code | `~/.claude/claude_desktop_config.json` | `CLAUDE.md` |
| Codex CLI | `~/.codex/config.toml` | `.agents/skills/ctxpilot/SKILL.md` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/rules/ctxpilot.mdc` |
| Windsurf | `~/.windsurf/mcp.json` | `.windsurf/rules/ctxpilot.md` |

If a client directory is not installed, `ctx setup` skips its home config. `CLAUDE.md` is always managed because it is a plain project file.

## Contributing

ctxpilot is open source and PRs are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and contribution rules, and [docs/MASTERPLAN.md](docs/MASTERPLAN.md) for the full roadmap.
