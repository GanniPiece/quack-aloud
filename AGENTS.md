# Quack Aloud: Codex project instructions

For development, read [docs/development.md](docs/development.md). Requests to explain or change the application are development work; do not file them as duck turns.

For thoughts submitted to the duck, read [docs/duck-guide.md](docs/duck-guide.md). Use the repository's `duck` skill (`$duck <thought>`), found at [.agents/skills/duck/SKILL.md](.agents/skills/duck/SKILL.md). Natural-language requests to organise thoughts on a Quack Aloud canvas can use the same skill. This does not register a literal `/duck` slash command.

Prefer MCP: `list_projects` → `read_canvas` → `duck_turn`; use `create_project` / `create_canvas` when requested. Guidance is off unless requested. Reply with the saved reply returned by the tool. The shared guide describes the local-file fallback, canvas schema, and target-selection rules.

The project MCP configuration at `.codex/config.toml` starts the local stdio server after `npm install`, when Codex trusts this project. For HTTP/Docker/remote setup, read [Agent setup in README.md](README.md#agent-setup). Never put MCP tokens in tracked configuration.

Browser chat uses the selected Claude or OpenAI API provider. Codex's own login and model are separate; do not change browser provider settings merely because Codex is acting as the duck.
