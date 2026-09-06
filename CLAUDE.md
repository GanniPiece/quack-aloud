# Rubber Duck: notes for Claude Code

> status: current

This document tells Claude Code how to act as the duck directly, without the API. Each project is one file under `data/projects/<id>.json`; the browser watches that folder, so editing the file of the project the user has open is enough to update the canvas live. Product overview and setup are in [README.md](README.md).

## The Claude Code route

| Step | Do | Note |
|---|---|---|
| 1 | User runs `npm run dev` and opens http://localhost:5173 | No API key needed for this route |
| 2 | User types their thoughts in the Claude Code chat, plainly or as `/duck <thought>`, and says whether they want guidance | Always organise: cards, themes (`groups`), relations, refinements of existing cards. Only add question / insight / to-do cards when they ask for guidance |
| 3 | Find the open project (`GET http://localhost:8787/api/projects`, or ask; the picker's tooltip shows the file path), read `data/projects/<id>.json`, then rewrite it with the new nodes and edges. If the user asks for a new project ("開新專案：<名稱>", "new project: <name>"), create `data/projects/p-YYYYMMDD-HHMMSS.json` first and file into it | Follow the rules below. Write the whole file as valid JSON in one go; the watcher retries on a half-written file but the UI flickers. To start a new project, create `data/projects/p-YYYYMMDD-HHMMSS.json` (the current local time) with `{"version":1,"name":"…","groups":[],"nodes":[],"edges":[],"messages":[]}` |
| 4 | Reply briefly in chat, the same way the duck would | 2–3 sentences, at most one question |

`/duck <thought>` (from `.claude/commands/duck.md`) runs exactly this route; use it when a message could be read as either a thought to file or a request to change the app.

## Rules for what to add

| Rule | Note |
|---|---|
| Decompose, do not transcribe: split each sentence into `entity` (noun, 1–3 words), `event` (verb phrase, 2–5 words), and `claim` (short statement) cards, and put the verbs on edges | Never a full sentence as a label. Each person / place / object exists once on the canvas. Keep the original fragment in `source` |
| Your additions are `origin: "ai"` and only `kind: "question"`, `"insight"`, `"todo"`, or `"challenge"` | Only when guidance is on. At most 3 per turn. A `challenge` is you doubting a statement (contradiction, unstated assumption, leap to conclusion); say why and connect it to the doubted card with an edge labelled `challenges` |
| Never recreate an existing node | Refine it in place (label, detail, group) or connect to it |
| Every card has a `group`; reuse existing themes, create a new one only for a genuinely new theme | Few, meaningful themes. Titles 1–3 words in the user's language |
| Inferring relations between cards is part of organising, even with guidance off | Mark inferred edges `origin: "ai"` |
| Build hierarchy: a card that is a kind / part / example of a concept links child -> parent with a label like `kind of`, `part of`, `屬於`, `是一種`. When a concept has more than 4 direct children, add an intermediate concept card per sub-theme and re-attach the children to it | The mind map follows these links first, so this is what gives it levels |
| Edges carry a 1–3 word `label` (`causes`, `depends on`, `contradicts`, `requires`) | `origin: "user"` if the user stated the relation, else `"ai"` |
| Place a new card under the last card of its theme (same `x`, `y` + 148); a new theme starts a column to the right (+360 on `x`) | The user can press "Tidy" if it gets messy |
| Set `suggestedLayout` to fit the content: `timeline` for stories and processes (and give events a `seq`), `mindmap` for knowledge around one concept (and set `root`), `layered` for cause/effect chains, `themes` otherwise | The browser re-arranges the canvas itself in every layout except `themes` |
| Append the user's message and your reply to `messages` | Keeps the in-app chat in sync. Give the user message and the new nodes the same `createdAt` / `ts` so the Timeline view groups them as one turn |

## Project file schema (`data/projects/<id>.json`)

| Field | Type | Note |
|---|---|---|
| `version` | `1` | |
| `name` | string | Shown in the project picker |
| `layout` | `"themes"` \| `"layered"` \| `"timeline"` \| `"mindmap"` | **Optional**. Pinned by the user; leave alone |
| `suggestedLayout` | same values | **Optional**. Your suggestion; used when `layout` is unset |
| `root` | string | **Optional**. Node id at the centre of the mind map |
| `groups[].id` | string | Unique slug, e.g. `symbols` |
| `groups[].title` | string | Shown on the container |
| `nodes[].id` | string | Unique slug, e.g. `cache-ttl` |
| `nodes[].label` | string | Short title |
| `nodes[].detail` | string | **Optional**. Attribute or clarification ("3 times") |
| `nodes[].source` | string | **Optional**. Verbatim fragment of the user's sentence; shown on hover and in Timeline |
| `nodes[].origin` | `"user"` \| `"ai"` | Drives the colour |
| `nodes[].kind` | `"entity"` \| `"event"` \| `"claim"` \| `"idea"` \| `"question"` \| `"insight"` \| `"todo"` \| `"challenge"` | `idea` is the fallback for hand-added cards |
| `nodes[].group` | string | **Optional**. A `groups[].id`; unknown ids are dropped on load |
| `nodes[].seq` | integer | **Optional**. Position on the story timeline, events only |
| `nodes[].x`, `nodes[].y` | number | Canvas coordinates |
| `nodes[].createdAt` | number | ms epoch; use `Date.now()` so the node pulses as new |
| `edges[].id` | string | Convention: `e-<source>-<target>` |
| `edges[].source`, `edges[].target` | string | Node ids; both must exist |
| `edges[].label` | string | **Optional** |
| `edges[].origin` | `"user"` \| `"ai"` | Solid vs dashed line |
| `messages[]` | `{ role: "user" \| "assistant", content, ts }` | |
| `updatedAt` | number | Server overwrites this; any value is fine |

Types are in `shared/graph.ts`; a worked example is `data/sample-graph.json`.

## Code conventions

| Rule | Note |
|---|---|
| LLM calls go through `ThinkProvider` in `server/providers/`; the prompt lives in `server/prompt.ts` | Never call an SDK from a route handler |
| UI strings are English; no emoji | Use the `DuckIcon` SVG for the duck |
| `data/projects/` is user data | Do not commit personal projects; `data/sample-graph.json` is the shareable example |
