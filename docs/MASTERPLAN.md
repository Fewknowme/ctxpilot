# ctxpilot Masterplan

Phase 1 status: complete.

Current product: a CLI and MCP server that build and maintain a Living Context Document (LCD) in `.ctxpilot/context.md`, keep it updated from repo activity, and expose it to Claude Code, Codex CLI, Cursor, and Windsurf.

## 0. Vision in one line

Keep one current project summary that every AI tool reads first.

## 1. Core problem

New AI sessions start blank. Developers repeat the project goal, recent decisions, current work, blockers, and coding rules over and over.

Rules files help, but they go stale. ctxpilot keeps a current LCD and exposes it through CLI commands, MCP, and tool-specific instruction files.

## 2. Product overview

### 2.1 Built today

- `ctx init` creates `.ctxpilot/` and the first LCD.
- `ctx update` merges recent repo changes and manual signals into the LCD.
- `ctx watch` runs a background daemon that triggers updates after changes.
- `ctx show` and `ctx inject` expose the current LCD.
- `ctx serve` starts the MCP server for the current project.
- `ctx setup` writes MCP config for installed clients and project instruction files for Claude Code, Codex CLI, Cursor, and Windsurf.

### 2.2 Who it is for

- Solo developers using more than one AI tool
- Small teams that want the same project context everywhere
- People who switch projects often and want less setup per session

### 2.3 Future scope

- Phase 2: hosted sync and team features
- Phase 3: smarter context across projects and workflows

## 3. Product architecture

```text
Project files + git + manual signals
  -> signal extraction
  -> LCD merge
  -> compression + archive
  -> .ctxpilot/context.md and .ctxpilot/archive/
  -> CLI commands and MCP tools
```

Current write paths inside a user project:

- `.ctxpilot/context.md`
- `.ctxpilot/config.json`
- `.ctxpilot/signals.json`
- `.ctxpilot/archive/`
- `.ctxpilot/daemon.pid`

## 4. Living Context Document

The LCD is the main artifact. It is a markdown file with the current project summary.

Current sections in the default template:

- Project identity
- Active goal
- Architecture decisions
- In progress
- Recently completed
- Known issues and blockers
- Conventions and preferences
- Key files
- Environment and setup notes
- Archived decisions

Current compression rules:

- Default token budget: `2000`
- Prefer recent work over old work
- Keep architecture decisions and active blockers
- Merge duplicates
- Archive removed text instead of deleting it

## 5. Tech stack

### 5.1 Built stack

Root workspace:

- Node.js 20+
- npm workspaces
- Turbo
- TypeScript

CLI package:

- Commander
- Chokidar
- simple-git
- dotenv
- zod
- Anthropic SDK
- OpenAI SDK
- `@anthropic-ai/tokenizer`
- `@iarna/toml`
- Vitest

MCP server package:

- `@modelcontextprotocol/sdk`
- dotenv
- zod

### 5.2 Not built in Phase 1

- Web dashboard
- Hosted sync
- Team permissions
- Cloud storage

## 6. Repo and runtime file structure

Current repo layout:

```text
ctxpilot/
  docs/
    MASTERPLAN.md
  packages/
    cli/
      src/
        ai/
        commands/
        config/
        core/
        index.ts
    mcp-server/
      src/
        config/
        resources/
        tools/
        index.ts
  README.md
  CONTRIBUTING.md
  LICENSE
```

Current runtime layout in a user project:

```text
.ctxpilot/
  context.md
  config.json
  signals.json
  archive/
  daemon.pid
```

## 7. CLI commands

Current command surface:

| Command | Current behavior |
| --- | --- |
| `ctx init` | Create `.ctxpilot/`, ask setup questions, generate the first LCD |
| `ctx setup` | Write MCP config for installed clients and tool-specific instruction files |
| `ctx update [--since <timeframe>]` | Merge recent repo changes and manual signals into the LCD |
| `ctx watch [--since <timeframe>]` | Start the background watcher and run updates after changes |
| `ctx build` | Rebuild the LCD from the current repo state |
| `ctx show [--raw] [--json]` | Print the current LCD |
| `ctx inject --format <markdown\|xml\|plaintext>` | Output the current LCD for prompts |
| `ctx signal <text>` | Store a manual signal for the next update |
| `ctx serve` | Start the MCP server for the current project |

Not shipped:

- `ctx archive`
- `ctx sync`

## 8. MCP server

Current resources:

- `context://project/current`
- `context://project/archive`
- `context://project/signals`

Current tools:

- `get_context`
- `update_context`
- `add_decision`
- `add_blocker`
- `search_archive`

Current client setup written by `ctx setup`:

| Client | Home config path | Project instruction path |
| --- | --- | --- |
| Claude Code | `~/.claude/claude_desktop_config.json` | `CLAUDE.md` |
| Codex CLI | `~/.codex/config.toml` | `.agents/skills/ctxpilot/SKILL.md` |
| Cursor | `~/.cursor/mcp.json` | `.cursor/rules/ctxpilot.mdc` |
| Windsurf | `~/.windsurf/mcp.json` | `.windsurf/rules/ctxpilot.md` |

## 9. AI pipeline

Current prompt flow:

- Init prompt: build the first LCD from file tree, `package.json`, `README.md`, git log, and key files
- Extract prompt: turn git diff, commits, modified files, and manual signals into structured signals
- Compress prompt: keep the LCD within budget without dropping important context

Current provider support:

- Anthropic
- OpenAI

Provider choice comes from `.env`, `~/.ctxpilot/.env`, or runtime env vars.

## 10. Configuration

Current config file: `.ctxpilot/config.json`

Current defaults include:

- `provider`
- `tokenBudget`
- `autoWatch`
- `watchTriggers`
- `fileIgnore`
- `aiModel`
- `archiveAfterDays`
- `sections`
- `team`
- `version`
- `lastUpdated`
- `lastTokenCount`

Current env vars in use:

- `CK_PROVIDER`
- `CK_API_KEY`
- `CK_OPENAI_API_KEY`
- `CK_MODEL`
- `CK_TOKEN_BUDGET`

## 11. Delivery phases

### Phase 1: CLI + MCP

Status: complete.

Done:

- [x] Monorepo
- [x] CLI package
- [x] MCP server package
- [x] `ctx init`
- [x] `ctx build`
- [x] `ctx update`
- [x] `ctx watch`
- [x] `ctx show`
- [x] `ctx inject`
- [x] `ctx signal`
- [x] `ctx serve`
- [x] `ctx setup`
- [x] `.ctxpilot/` storage and archive
- [x] Provider env resolution
- [x] Unit tests
- [x] Build scripts

Definition of done:

- [x] Local LCD storage works
- [x] Incremental update works
- [x] MCP server starts for the current project
- [x] `ctx setup` writes config for supported clients
- [x] Background watch daemon works

### Phase 2: hosted and team roadmap

Future work:

- Hosted project view
- Shared LCD for teams
- Version history and diff view
- Access control
- Sync between local CLI and hosted state

### Phase 3: intelligence roadmap

Future work:

- Cross-project context
- Branch-aware and PR-aware context
- Conversation import
- More editor and workflow integrations
- CI-triggered context refresh

## 12. Monetization

Not built.

If monetization is added later, it should live in hosted sync and team features. The local CLI and MCP core should stay usable on their own.

## 13. Distribution

Current distribution:

- GitHub for source
- npm package name `ctxpilot`
- Local CLI aliases `ctxpilot` and `ctx`

Current documentation priority:

- Clear README
- Simple setup
- Accurate client support docs

## 14. Differentiation

Current strengths:

- Local-first project storage
- Works across multiple AI clients
- MCP plus native instruction-file setup
- Repo-aware updates from git, file changes, and manual signals
- No extra service needed for local use

## 15. Technical risks

| Risk | Current mitigation |
| --- | --- |
| Compression drops useful context | Archive removed content and keep decisions/blockers |
| Watch loop retriggers itself | Ignore `.ctxpilot/` output files |
| Stale project instructions | `ctx setup` rewrites supported project instruction files where needed |
| Client config drift | `ctx setup` rewrites MCP entries for installed clients |
| Provider setup errors | Resolve provider from env and fail with explicit messages |

## 16. Open source

Current position:

- License: MIT
- Repo accepts pull requests
- Main contribution areas: CLI behavior, MCP setup, prompt quality, tests, docs

## 17. Success metrics

Current Phase 1 success checks:

- [x] One command to initialize local context
- [x] One command to wire supported clients
- [x] One command to keep context fresh in the background
- [x] Tests cover core CLI and MCP helpers

Future checks:

- More real projects using `ctx setup`
- Fewer manual context resets across clients
- Stable hosted/team scope for Phase 2

## 18. Local development

```bash
npm install
npm run build
npm test
npm run typecheck
```

## 19. Prompt for contributors and AI helpers

Use this as a short project handoff:

```text
Project: ctxpilot
What it is: A CLI and MCP server that keep a Living Context Document in .ctxpilot/context.md and expose it to AI tools.
Current focus: Replace with the task at hand.
Key commands: ctx init, ctx setup, ctx update, ctx watch, ctx show, ctx inject, ctx serve, ctx signal.
Key files:
- packages/cli/src/core/lcd.ts
- packages/cli/src/core/compressor.ts
- packages/cli/src/core/builder.ts
- packages/cli/src/core/mcp.ts
- packages/mcp-server/src/index.ts
Rules:
- Keep docs accurate to shipped behavior.
- Prefer simple English.
- Add tests for behavior changes.
```
