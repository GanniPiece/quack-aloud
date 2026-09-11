# Quack Aloud: notes for Claude Code

> status: current

For development, read [docs/development.md](docs/development.md). Requests to explain or modify the app are development work; do not file those as duck turns.

For thoughts submitted plainly or as `/duck <thought>`, read and follow [docs/duck-guide.md](docs/duck-guide.md). It holds the shared organising rules, guidance modes, MCP workflow, local-file fallback, and canvas schema. [.claude/commands/duck.md](.claude/commands/duck.md) is the explicit command entry point.

Prefer MCP: `.mcp.json` registers `quack-aloud` on stdio. When the app runs elsewhere, connect to `http://<host>:8787/mcp` with the token from Settings → MCP access. Use `list_projects` → `read_canvas` → `duck_turn`, or create a project/canvas when requested. Return the tool's saved reply. If tools are unavailable, use the shared guide's local-file fallback.

Claude Code is an external agent, independent of the browser's Claude/OpenAI API provider. Browser chat gets its instructions from `server/prompt.ts`, not this file. Codex uses `AGENTS.md`; Antigravity uses `.agents/rules/quack-aloud.md`. Both share `.agents/skills/duck/SKILL.md`, invoked as `$duck` in Codex and `/duck` in Antigravity. All three use the same canvases and organising rules.

See [Agent setup in README.md](README.md#agent-setup) for local, HTTP, Docker, remote, and sign-in instructions. Start a fresh Claude Code session after adding the `/duck` command if it is not yet visible.
