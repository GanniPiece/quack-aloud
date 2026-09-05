# Rubber Duck

> status: MVP, single user, local only

Rubber Duck is a "rubber duck debugging" tool with a canvas. You describe your understanding of something in fragments in the chat; an LLM organises those fragments into cards, sorts them into themes, and draws the relations between them on an infinite canvas next to it. With **AI guidance** off that is all it does. With it on, the duck also adds its own questions and observations, marked as its own. This document is for anyone running or extending the app.

Not in this document:
- How Claude Code edits the canvas directly: see [CLAUDE.md](CLAUDE.md)

## How it works

| Piece | What it does | Note |
|---|---|---|
| `data/projects/<id>.json` | One file per project: name, themes, cards, relations, chat history, layout | Single source of truth. Every writer (chat API, browser edits, Claude Code, a text editor) writes these files. An older `data/graph.json` is moved into the first project on startup |
| `server/` | Express API on `API_PORT` | Watches `data/projects/` and pushes every change to browsers over SSE (`/api/events`) |
| `server/providers/` | LLM backends | Swappable via `PROVIDER`. Only `claude` is implemented |
| `src/` | Vite + React + React Flow UI | Chat on the left, canvas on the right |

## Getting started

1. `npm install`
2. `cp .env.example .env`
3. Put your Anthropic API key in `.env` as `ANTHROPIC_API_KEY` (create one at console.anthropic.com; it is billed per token, separately from a Claude.ai subscription)
4. `npm run dev`
5. Open http://localhost:5173
6. Type something like "The home page loads slowly, I think it's the database" and press Enter. You should see two yellow cards inside a tinted theme container, an edge between them, and a one-line reply saying what was filed
7. Switch on **AI guidance** (top of the chat) and send another thought. You should now also see one or two dashed blue cards from the duck and a short conversational reply

To try the canvas without an API key, use "Import" (top right of the canvas) on `data/sample-graph.json`; it becomes a new project.

## Configuration (`.env`)

| Key | Default | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Required for the `claude` provider |
| `PROVIDER` | `claude` | **Optional**. Name registered in `server/providers/index.ts` |
| `CLAUDE_MODEL` | `claude-opus-5` | **Optional** |
| `CLAUDE_EFFORT` | `medium` | **Optional**. `low` / `medium` / `high` / `xhigh` / `max`. Higher is slower and costs more |
| `API_PORT` | `8787` | **Optional**. The Vite dev server proxies `/api` to this port |

## Projects

| Control | Where | What it does | Note |
|---|---|---|---|
| Project picker | Top bar, next to the title | Switch between projects. Each project is its own canvas and chat | The last opened project is remembered per browser |
| + New project… | Last entry of the picker | Type a name, Enter | Starts empty |
| Rename / Delete | Next to the picker | Rename inline; Delete asks once, inline | A deleted project is moved to `data/trash/<id>-<time>.json`, not removed; copy it back into `data/projects/` to restore it. Deleting the last project creates a fresh empty one |

## Modes and views

| Control | Where | What it does | Note |
|---|---|---|---|
| AI guidance toggle | Top of the chat | Both modes organise: cards, themes, relations, and refinements of existing cards. **Off** (Default): nothing else; the reply is one line saying what was filed. **On**: the duck also adds question / insight / to-verify / challenge cards and replies conversationally, pushing back on anything it doubts | Enforced server-side: with guidance off, any question / insight / to-verify card is dropped and a reply containing a question is replaced by a plain summary |
| Map / Timeline | Top bar | **Map**: the free-form canvas. **Timeline**: the same cards grouped by the turn that created them, in the order you said them | Both read the same `graph.json`; the choice is remembered per browser |
| Layout (on the map) | Top right of the canvas | How cards are arranged. **Auto** (Default) follows the duck's suggestion for the content; or pin one: **Themes** (one column per theme with containers), **Layered** (ranked left-to-right by edge direction, for cause/effect and dependencies), **Timeline** (a numbered time axis through the events, with labelled swim lanes: people and things above, claims and beliefs below, the duck's notes at the bottom; for stories and processes), **Mind map** (a tree spreading from the central concept, for knowledge; hierarchy relations such as "kind of", "part of", 屬於 are followed first, so intermediate concept cards become the levels) | Changing it re-arranges the canvas right away. After each duck turn the canvas is re-arranged in the current layout, except Themes, where new cards simply join their theme's column |

## Chat

| Feature | Note |
|---|---|
| Your message appears at once, marked "Sending…" | Replaced by the saved copy when the duck answers |
| Keep typing while the duck thinks | Enter or "Queue" adds the message to a queue; messages are sent one at a time in order. If a send fails, the failed message and everything queued behind it go back into the box |
| Dictation | The microphone button next to Send uses the browser's speech recognition (Chrome, Edge, Safari). Speak, watch the text appear, press Enter. Language follows the browser's language; the button is hidden where the API is not available |

## Using the canvas

| Action | How |
|---|---|
| Add your own card | Double-click empty space, type the label, press Enter (Esc cancels) |
| Connect two nodes | Drag from a node's right handle to another node |
| Edit a label | Double-click the card, type, press Enter |
| Move a node | Drag it. Positions are saved |
| Select several | Drag a box on empty space (touching a card is enough), or Shift+click. Drag any selected card to move them all |
| Pan / zoom | Scroll or pinch to zoom around the cursor; hold Space and drag, or middle- or right-drag, to pan |
| Delete | Select, then Backspace or Delete |
| Re-lay out everything | "Tidy" (top right), in the current layout |
| Save a copy | "Export" (top right). Downloads the current project, chat included, as `rubber-duck-<project>-<date>.json` |
| Load a copy | "Import" (top right). Creates a new project from an exported file and switches to it; nothing is overwritten. Any valid project file works, including one written by hand |
| Start over | "Clear" (top right), then confirm with "Really clear everything?". Empties the current project but keeps it |
| Hide the chat | "Hide chat" in the top bar, or the ‹ button on the chat panel. The canvas takes the full width; the choice is remembered per browser |

| Visual | Meaning |
|---|---|
| Yellow card, solid border | Something you said (`origin: "user"`), broken down into its parts: a **pill** is an entity (a person, thing, or place), a **card with a square marker** is an event, a **quoted card** is a claim or belief. Hover a card to see the fragment of your sentence it came from |
| Blue card, dashed border | The duck's addition (`origin: "ai"`): a question, an insight, or something to verify. Only with guidance on |
| Red card, dashed border, "!" | A challenge: the duck doubts what you said (a contradiction with the canvas, an unstated assumption, a leap from evidence to conclusion) and says why. Connected to the card it doubts with "challenges". Only with guidance on |
| Tinted container with a title | A theme the duck sorted cards into. New cards stack under their theme; "Tidy layout" makes one column per theme |
| Solid edge | A relation you stated |
| Dashed edge | A relation the duck inferred from the content |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API server + Vite with hot reload |
| `npm run build` | Typecheck, then build the UI into `dist/` |
| `npm start` | Serve API and the built UI from one process on `API_PORT` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests (Vitest) for the graph merge logic, prompt assembly, and the four layouts. `npm run test:watch` re-runs on change |

## Adding another LLM provider

1. Create `server/providers/<name>.ts` implementing `ThinkProvider` from `server/providers/types.ts`. `think()` receives the assembled system prompt, recent history, and the user turn, and must return an object matching `ThinkOutputSchema`
2. Register it in `REGISTRY` in `server/providers/index.ts`
3. Add that SDK's error mapping to `describeProviderError` in the same file
4. Set `PROVIDER=<name>` in `.env`

The prompt itself lives in `server/prompt.ts` and is shared by all providers.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chat says "No credentials for provider" | `.env` missing or key empty | Fill in `ANTHROPIC_API_KEY`, restart `npm run dev` |
| Top-right pill says "disconnected" | API server not running or on a different port | Check the `[server]` lines in the terminal; match `API_PORT` |
| Canvas empty after editing a project file by hand | Invalid JSON, or nodes missing `id` / `label` | The server skips unreadable files and drops bad entries; fix the JSON and save again |
| A project vanished from the picker | Its file was deleted or renamed to something other than `<id>.json` (lowercase letters, digits, dashes) | Put it back under `data/projects/` with a valid name |
