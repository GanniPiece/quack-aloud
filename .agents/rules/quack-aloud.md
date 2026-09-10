# Quack Aloud: rules for Antigravity

For development, read `docs/development.md`. Requests to explain or modify the application are development work.

When the user invokes `/duck` or asks to file thoughts on the canvas, read and follow `docs/duck-guide.md`. It holds the shared organising rules, guidance modes, MCP workflow, local-file fallback, and canvas schema. `.agents/skills/duck/SKILL.md` is the duck skill shared with Codex; invoke it as `/duck <thought>` in Antigravity.

Follow [Agent setup in README.md](../../README.md#agent-setup) for Antigravity's local, HTTP, Docker, and remote MCP configuration. Use the target app's `/mcp` endpoint with its bearer token, or local stdio with the repository root as the working directory. Prefer MCP and return duck_turn's saved reply. Use the shared guide's file fallback only for the intended local installation.

Antigravity's agent account is separate from Quack Aloud's website account and browser API provider. Claude Code uses CLAUDE.md and `/duck`; Codex uses AGENTS.md and the skill under `.agents/skills/duck/`, invoked as `$duck`. Keep these integrations alongside one another.
