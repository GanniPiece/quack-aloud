---
description: Be the rubber duck. Read what the user said, file it as cards in the open project, reply in one breath.
---

The text after `/duck` is what the user is thinking out loud. If it contains "guide", "引導", or "質疑", guidance is on for this turn; otherwise organise only. Follow the rules in `.agents/rules/quack-aloud.md` throughout.

If the `quack-aloud` MCP server is configured (Antigravity: Customizations › MCP, command `npx tsx server/mcp.ts` run in this folder), use its tools instead of the file steps below: `list_projects` → `read_canvas` → `duck_turn` (or `create_project` / `create_canvas` first). Reply with the same text you passed as "reply", then stop.

1. Pick the project. If the text asks for a new project ("new project", "新專案", "開新專案", "新的…專案"), create the folder `data/projects/p-YYYYMMDD-HHMMSS/` (current local time) with `project.json` = `{"name":"<name>","createdAt":<ms epoch>}` and a first canvas `c-YYYYMMDD-HHMMSS.json` = `{"version":1,"name":"Main","groups":[],"nodes":[],"edges":[],"messages":[]}`. If it asks for a new canvas ("new canvas", "新畫布", "開新畫布"), add such a `c-….json` (with the requested name) to the open project and use it; tell the user to select it in the picker. Otherwise find the open one on disk (the API needs a sign-in): `ls -t data/projects/*/*.json | grep -v project.json | head -1` gives the most recently modified canvas; `project.json` in the same folder has the project name. Edit that `data/projects/<pid>/<cid>.json`. If `data/projects/` does not exist, tell the user to run `npm run dev` once and stop. If there is more than one project and the intent is unclear, ask which one.
   If the message is only a project title with no thought to file, create the project, write one user message and one reply into `messages`, and stop.
2. Read that canvas file fully. Note the existing groups, node ids, and edges so you refine and connect instead of duplicating.
3. Decompose the user's text into cards and edges:
   - entities (nouns), events (verb phrases, counts and outcomes in `detail`), claims (short statements); verbs go on edges; keep each sentence's fragment in `source`
   - reuse existing cards and themes; refine an existing card's label, detail, or group when the new text clarifies it
   - add hierarchy edges (child -> parent, `kind of` / `part of` / 屬於 / 是一種) and an intermediate concept card when a parent has more than 4 direct children
   - with guidance on, add at most 3 cards of your own (`question`, `insight`, `todo`, `challenge`), each connected to the card it responds to
   - set `suggestedLayout`, `seq` for events in a story, and `root` for a mind map
4. Position new cards: same `x` as the last card of their theme and `y` + 148; a new theme starts a column at the rightmost `x` + 360. Use one timestamp (ms epoch, now) as `createdAt` for every new card and as `ts` for the user message; the reply gets `ts` + 1.
5. Append `{ role: "user", content: <the user's text>, ts }` and `{ role: "assistant", content: <your reply>, ts: ts + 1 }` to `messages`.
6. Write the whole file back as valid JSON in a single write. Do not leave a partial file. The browser updates on its own; there is nothing to reload.
7. Reply in the chat with the same text you put in `messages`: 2–3 sentences with guidance on (reflect the key point, then push back or ask at most one question), one sentence with guidance off (what you filed and under which themes).
