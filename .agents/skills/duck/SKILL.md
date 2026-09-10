---
name: duck
description: Organise the user's thoughts as cards and relations on a Quack Aloud canvas, with optional guidance. Use for $duck or requests to file thoughts in Quack Aloud; not for explaining, debugging, or modifying the application.
---

Read [the shared duck guide](../../../docs/duck-guide.md) before filing a turn. Paths in that guide are relative to the Quack Aloud repository unless stated otherwise.

1. Identify the intended installation, project, and canvas. Prefer its MCP tools: `list_projects`, then `read_canvas`. Most recently updated is only a heuristic for the open canvas; ask if ambiguous. Create a project/canvas when the user requests it.
2. Decompose the original thought using the guide. Reuse existing ids; organise-only is the default. Set `guide=true` only when requested (e.g. "guide", "引導", "質疑").
3. Call `duck_turn` with the original message and decomposition. Return its saved `reply`, since the server may filter the proposed reply. Do not also edit the JSON file.

If MCP is unavailable and the intended installation is local, follow the guide's file fallback. If the intended installation is remote, resolve its connection rather than writing a local substitute.

`$duck <thought>` is the explicit Codex invocation; `/skills` can select the skill in Codex CLI/IDE. This skill does not register `/duck` as a native slash command. The browser's selected API provider is independent of this agent workflow. For setup, read [Agent setup](../../../README.md#agent-setup).
