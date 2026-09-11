# Quack Aloud: shared duck guide

Read this guide when acting as the duck through Claude Code, Codex, or Antigravity. Browser chat uses `server/prompt.ts`; MCP advertises those same runtime organising rules. These files document the agent workflow and its local-file fallback.

## Choose the workflow

A request to explain, debug, or modify the application is development work. A thought explicitly submitted to the duck should be filed on a canvas. Claude Code and Antigravity use `/duck`; Codex uses `$duck`. Follow the user's requested target and guidance mode.

## Prefer MCP

1. Call `list_projects`, then `read_canvas` with explicit project/canvas ids. The server cannot see browser selection: most recently updated is a heuristic, so ask if the target is unclear. Read before writing; reuse existing cards and themes.
2. For "new project: …" / "開新專案：…", call `create_project`. For "new canvas: …" / "開新畫布：…", call `create_canvas`. If there is only a title and no thought, create it and give a brief acknowledgement; do not invent cards.
3. Decompose the thought using the rules below. Call `duck_turn` with the original message, guidance flag, and the complete decomposition (including empty arrays and null layout/root where appropriate).
4. Return the tool's saved `reply`, which may differ from the proposed reply after organise-only filtering. Do not also edit the canvas file: that would apply the turn twice.

Guidance is on when requested (e.g. "guide", "引導", "質疑"); otherwise organise only. With guidance off, propose one sentence saying what was filed, with no question. With guidance on, use 2–3 conversational sentences and at most one question. A browser's guidance toggle does not automatically set the external agent's mode. After creating a project/canvas, tell the user to select it in the browser picker.

## Local-file fallback

Use this only when MCP is unavailable and the agent has access to the intended installation's project files. An unreachable remote MCP endpoint is not permission to write a different local installation.

- Use the app's configured `DATA_DIR` (default `<repo>/data`). Canvas files are `projects/<pid>/<cid>.json`; `project.json` is metadata, not a canvas. Select the requested canvas or the most recently modified one if unambiguous. Read the entire canvas first. If no project exists, run the app once to initialise it.
- For a new project, create `projects/p-YYYYMMDD-HHMMSS/project.json` with `{"name":"…","createdAt":<ms>}`, then a first canvas `c-YYYYMMDD-HHMMSS.json`. Add a suffix on an id collision. A new canvas in an existing project needs only its canvas file. Empty canvas: `{"version":1,"name":"Main","groups":[],"nodes":[],"edges":[],"messages":[]}`.
- Preserve existing content and user-pinned layout. Refine rather than duplicate. Use one current timestamp for new cards and the user message; the assistant reply gets timestamp + 1. Append both messages.
- Recheck that the source file has not changed while you prepared the turn; if it changed, reread and merge again. Write valid JSON atomically through a temporary file in the same directory and rename it into place.
- Use the positioning rules below. The running app watches the files and updates the canvas/chat through SSE. This route needs no browser session, but viewing the website still requires its normal sign-in. Reply with the same text saved in messages.

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
| Set `suggestedLayout` to fit the content: `timeline` for stories and processes (and give events a `seq`), `mindmap` for knowledge around one concept (and set `root`), `layered` for cause/effect chains, `themes` otherwise | The browser auto-tidies new agent cards in every layout when Auto is on |
| Append the user's message and your reply to `messages` | Keeps the in-app chat in sync. Give the user message and the new nodes the same `createdAt` / `ts` so the Timeline view groups them as one turn |

## Canvas file schema (`data/projects/<pid>/<cid>.json`)

`project.json` next to it is `{ "name": string, "createdAt": number }`. Ids are lowercase letters, digits, and dashes; `project` is reserved.

| Field | Type | Note |
|---|---|---|
| `version` | `1` | |
| `name` | string | The canvas name, shown in the picker |
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

Types are in `../shared/graph.ts`; a worked example is `../data/sample-graph.json`.
