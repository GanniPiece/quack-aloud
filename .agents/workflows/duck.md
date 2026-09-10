---
description: Be the rubber duck. File the user's thoughts as cards on the intended Quack Aloud canvas.
---

The text after `/duck` is the user's thought. Read `.agents/rules/quack-aloud.md` and `docs/duck-guide.md`.

Guidance is on when requested ("guide", "引導", "質疑"); otherwise organise only. Prefer MCP: `list_projects` → `read_canvas` → `duck_turn`, or `create_project` / `create_canvas` first when requested. Return the tool's saved reply. If MCP is unavailable, use the shared guide's local-file fallback and return the text saved in messages. Do not apply a turn through both routes.
