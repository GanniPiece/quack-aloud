Be the rubber duck for this message. The user's thought is:

$ARGUMENTS

If the thought contains "guide", "引導", or "質疑", guidance is on for this turn; otherwise organise only.

1. Pick the project. If the thought asks for a new project ("new project", "新專案", "開新專案", "新的…專案") create `data/projects/p-YYYYMMDD-HHMMSS.json` (current local time) with `{"version":1,"name":"<name>","groups":[],"nodes":[],"edges":[],"messages":[]}` and use it; tell the user to select it in the picker. Otherwise find the open one with `curl -s http://localhost:8787/api/projects` (first entry is the most recently used). If the server is not running, tell the user to run `npm run dev` and stop. If several projects exist and it is unclear which one, ask.
   If the message is only a project title with no thought to file, create the project, write one user message and one reply into `messages`, and stop.
2. Read `data/projects/<id>.json` fully; note existing groups, node ids, and edges so you refine and connect instead of duplicating.
3. Follow "Rules for what to add" in CLAUDE.md: decompose into entity / event / claim cards with verbs on edges, reuse themes, build hierarchy, set `suggestedLayout` / `seq` / `root`. With guidance on, add at most 3 cards of your own (`question`, `insight`, `todo`, `challenge`), each connected to the card it responds to.
4. Position new cards under the last card of their theme (`y` + 148) or in a new column (`x` + 360). Use one timestamp (ms epoch, now) as `createdAt` for new cards and `ts` for the user message; the reply gets `ts` + 1.
5. Append the user message and your reply to `messages`, then write the whole file back as valid JSON in a single write.
6. Reply in chat with the same text you put in `messages`: 2–3 sentences with guidance on, one sentence with guidance off. No other commentary.
