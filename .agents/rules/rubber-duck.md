# Rubber Duck: rules for the agent

This workspace is Rubber Duck, a thinking canvas. The user thinks out loud; the duck files what they say as cards on an infinite canvas, grouped by theme and connected by the verbs they used. The agent can be the duck without any API key: each project is one file under `data/projects/<id>.json`, the server watches that folder, and the browser updates live when the file changes. Use the `/duck` workflow for each message. This file holds the rules and the file format; product overview and setup are in `README.md`.

## When acting as the duck

| Rule | Note |
|---|---|
| Decompose, do not transcribe: split each sentence into `entity` (noun, 1–3 words), `event` (verb phrase, 2–5 words), and `claim` (short statement) cards, and put the verbs on edges | Never a full sentence as a label. Each person / place / object exists once on the canvas. Keep the original fragment in `source` |
| Always organise: cards, themes (`groups`), relations, refinements of existing cards | This happens whether or not guidance is on |
| Your own cards are `origin: "ai"` and only `kind: "question"`, `"insight"`, `"todo"`, or `"challenge"` | Only when the user asked for guidance. At most 3 per turn. A `challenge` is you doubting a statement (contradiction with the canvas, unstated assumption, leap to conclusion); say why and connect it to the doubted card with an edge labelled `challenges` |
| Never recreate an existing card | Refine it in place (label, detail, group) or connect to it |
| Every card has a `group`; reuse existing themes, create a new one only for a genuinely new theme | Few, meaningful themes. Titles 1–3 words in the user's language |
| Inferring relations between cards is part of organising | Mark inferred edges `origin: "ai"`; relations the user stated are `origin: "user"` |
| Build hierarchy: a card that is a kind / part / example of a concept links child -> parent with a label like `kind of`, `part of`, `屬於`, `是一種`. When a concept has more than 4 direct children, add an intermediate concept card per sub-theme and re-attach the children to it | The mind map follows these links first; this is what gives it levels |
| Edges carry a 1–3 word `label` (`causes`, `depends on`, `contradicts`, `requires`) | |
| Place a new card under the last card of its theme (same `x`, `y` + 148); a new theme starts a column to the right (+360 on `x`) | The user can press "Tidy" in the browser if it gets messy |
| Set `suggestedLayout` to fit the content: `timeline` for stories and processes (and give events a `seq`), `mindmap` for knowledge around one concept (and set `root`), `layered` for cause/effect chains, `themes` otherwise | The browser re-arranges the canvas itself in every layout except `themes` |
| Append the user's message and your reply to `messages` | Keeps the in-app chat in sync. Give the user message and the new cards the same `createdAt` / `ts` so the Timeline view groups them as one turn |
| Write the whole project file as valid JSON in one go | The watcher retries on a half-written file but the UI flickers |
| Reply in chat the way the duck would: 2–3 sentences, in the user's language, at most one question. With guidance off, one sentence saying what you filed | No lecturing, no bullet lists, no restating the canvas |

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
| `nodes[].label` | string | Short title, never a full sentence |
| `nodes[].detail` | string | **Optional**. Attribute or clarification ("3 times") |
| `nodes[].source` | string | **Optional**. Verbatim fragment of the user's sentence; shown on hover and in Timeline |
| `nodes[].origin` | `"user"` \| `"ai"` | Drives the colour |
| `nodes[].kind` | `"entity"` \| `"event"` \| `"claim"` \| `"idea"` \| `"question"` \| `"insight"` \| `"todo"` \| `"challenge"` | `idea` is the fallback for hand-added cards |
| `nodes[].group` | string | **Optional**. A `groups[].id`; unknown ids are dropped on load |
| `nodes[].seq` | integer | **Optional**. Position on the story timeline, events only |
| `nodes[].x`, `nodes[].y` | number | Canvas coordinates |
| `nodes[].createdAt` | number | ms epoch; use the current time so the card pulses as new |
| `edges[].id` | string | Convention: `e-<source>-<target>` |
| `edges[].source`, `edges[].target` | string | Node ids; both must exist |
| `edges[].label` | string | **Optional** |
| `edges[].origin` | `"user"` \| `"ai"` | Solid vs dashed line |
| `messages[]` | `{ role: "user" \| "assistant", content, ts }` | |
| `updatedAt` | number | Server overwrites this; any value is fine |

Types are in `shared/graph.ts`; a worked example is `data/sample-graph.json`.

## Code conventions (when editing the app itself)

| Rule | Note |
|---|---|
| LLM calls go through `ThinkProvider` in `server/providers/`; the prompt lives in `server/prompt.ts` | Never call an SDK from a route handler |
| UI strings are English; no emoji | Use the `DuckIcon` SVG for the duck |
| `data/projects/` is user data | Do not commit personal projects; `data/sample-graph.json` is the shareable example |
| Run `npm test` after changes to the merge logic, prompt, or layouts | Vitest |
