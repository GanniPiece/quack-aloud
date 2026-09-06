---
description: Be the rubber duck. Read what the user said, file it as cards in the open project, reply in one breath.
---

The text after `/duck` is what the user is thinking out loud. If it contains "guide", "引導", or "質疑", guidance is on for this turn; otherwise organise only. Follow the rules in `.agents/rules/rubber-duck.md` throughout.

1. Find the open project: run `curl -s http://localhost:8787/api/projects` and take the first entry (the list is sorted by last update). If the server is not running, tell the user to run `npm run dev` and stop. If there is more than one project and the intent is unclear, ask which one.
2. Read `data/projects/<id>.json` fully. Note the existing groups, node ids, and edges so you refine and connect instead of duplicating.
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
