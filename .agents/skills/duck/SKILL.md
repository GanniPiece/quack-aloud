---
name: duck
description: Organise the user's thoughts as cards and relations on a Quack Aloud canvas, with optional guidance. Use for $duck, /duck, or requests to file thoughts in Quack Aloud; not for explaining, debugging, or modifying the application.
---

# Duck

This skill is shared by Codex and Antigravity. Treat the text after the invocation, or the natural-language request that selected this skill, as the user's thought.

Read [the shared duck guide](../../../docs/duck-guide.md) before filing a turn. Paths in that guide are relative to the Quack Aloud repository unless stated otherwise.

1. Identify the intended installation, project, and canvas. Prefer its MCP tools: `list_projects`, then `read_canvas`. Most recently updated is only a heuristic for the open canvas; ask if ambiguous. Create a project/canvas when the user requests it.
2. Decompose the original thought using the guide. Reuse existing ids; organise-only is the default. Set `guide=true` only when requested (e.g. "guide", "引導", "質疑").
3. Call `duck_turn` with the original message and decomposition. Return its saved `reply`, since the server may filter the proposed reply. Do not also edit the JSON file.

If MCP is unavailable and the intended installation is local, follow the guide's file fallback and return the reply saved in messages. If the intended installation is remote, resolve its connection rather than writing a local substitute.

## Invocation and setup

- Codex: use `$duck <thought>`; `/skills` can select the skill in Codex CLI/IDE. This file does not register `/duck` as a native Codex slash command. Project instructions are in `AGENTS.md`.
- Antigravity: use `/duck <thought>`. Follow its project instructions in `.agents/rules/quack-aloud.md`.

The browser's selected API provider is independent of this agent workflow. For each client's MCP setup, read [Agent setup](../../../README.md#agent-setup).
