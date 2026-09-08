# Quack Aloud

> status: MVP, single user, local only

中文版：[README.zh-TW.md](README.zh-TW.md)

Quack Aloud is rubber-duck debugging with a canvas: you think out loud to a duck, and it files what you say as cards, themes, and relations on an infinite canvas next to the chat. Switch on **AI guidance** and it also asks questions and pushes back, in cards marked as its own. This document is for anyone running or extending the app.

Not in this document:
- How Claude Code edits the canvas directly: see [CLAUDE.md](CLAUDE.md)

## Why

Most AI tools invert the order of thinking: you ask, the model answers, and you are left checking work you did not do. Quack Aloud borrows two habits Terence Tao recommends for using AI in mathematics:[^tao] keep the substance human and delegate only the mechanical part, and use AI mostly to red-team your own work. The duck never writes the idea; it files yours so you can check every card against your own words, and, when asked, it argues back. What you end up with is your own understanding, laid out so you can see where it is thin.

[^tao]: Terence Tao, ["Mathematical methods and human thought in the age of AI"](https://terrytao.wordpress.com/2026/03/29/mathematical-methods-and-human-thought-in-the-age-of-ai/) (29 March 2026): statements of theorems written or carefully reviewed by humans, proofs delegated to tools; AI use kept to red-teaming one's own work or to work one can red-team oneself. See also his ICM 2026 lecture ["Mathematics in the age of AI"](https://mathstodon.xyz/@tao/116977934921819775). His subject is proofs; this tool only borrows the habits.

## Demo

| Scenario | What happens |
|---|---|
| ![Talking to the duck on the full-screen stage](docs/demo-talk.gif) | **Talking to the duck**. "Talk to the duck" opens the stage: type (or dictate) under a big duck, send, watch it think, and read the reply right there; back on the canvas the new cards are already filed. Here it questions the cause-and-effect in "after the omen, two families moved away" |
| ![Plotting a story with AI guidance on](docs/demo-novel.gif) | **Plotting a story** (guidance on). Three fragments of a mystery go in; the duck files people, events, and claims, picks the Timeline layout, and when the third message jumps from "she saw a cat" to "so he was telling the truth", it pushes back with a challenge card |
| ![Learning a new topic, guidance off then on](docs/demo-learning.gif) | **Learning something new** (guidance off, then on). Notes about TOPS become a mind map with intermediate concepts; switching guidance on and stating "higher TOPS always means faster" earns a challenge about INT8 vs FP16 and memory bandwidth |

## How it works

| Piece | What it does | Note |
|---|---|---|
| `data/projects/<pid>/` | One folder per project: `project.json` (name) and one file per canvas `<cid>.json` with themes, cards, relations, chat history, layout | Single source of truth. Every writer (chat API, browser edits, Claude Code, a text editor) writes these files. Older layouts (`data/graph.json`, flat `data/projects/<id>.json`) are migrated on startup |
| `server/` | Express API on `API_PORT` | Watches `data/projects/` and pushes every change to browsers over SSE (`/api/events`) |
| `server/providers/` | LLM backends | Swappable via `PROVIDER`. Only `claude` is implemented |
| `src/` | Vite + React + React Flow UI | Chat on the left, canvas on the right |
| `CLAUDE.md`, `.agents/` | Rules for coding agents that act as the duck without an API key | Claude Code reads `CLAUDE.md`; Google Antigravity reads `.agents/rules/quack-aloud.md` and gets a `/duck` workflow from `.agents/workflows/duck.md`. Run `npm run dev`, open the project in the browser, then type your thought to the agent (`/duck …` in either; plain text also works in Claude Code; add "guide" or "引導" for questions and challenges). It edits the project file and the canvas updates live, on the agent's own plan rather than a Gemini or Claude API key |

## Getting started

1. `npm install`
2. `cp .env.example .env`
3. Put your Anthropic API key in `.env` as `ANTHROPIC_API_KEY` (create one at console.anthropic.com; it is billed per token, separately from a Claude.ai subscription)
4. `npm run dev`
5. Open http://localhost:5173
6. Type something like "The home page loads slowly, I think it's the database" and press Enter. You should see two yellow cards inside a tinted theme container, an edge between them, and a one-line reply saying what was filed
7. Switch on **AI guidance** (top of the chat) and send another thought. You should now also see one or two dashed blue cards from the duck and a short conversational reply

To try the canvas without an API key, use "Import" (top right of the canvas) on `data/sample-graph.json`; it becomes a new project.

## Run with Docker

One image serves the API and the built UI on port 8787; projects live on a volume.

| Step | Command | Note |
|---|---|---|
| 1 | `cp .env.example .env` and fill in `ANTHROPIC_API_KEY` | The container reads `.env` through `docker compose` |
| 2 | `docker compose up --build` | Builds the image and starts it; open http://localhost:8787 |
| 3 | Data is the same `./data/` folder the dev server uses | `projects/`, `trash/`, backups. The Claude Code and Antigravity routes keep working: they edit `data/projects/<id>.json` on the host and the container's watcher picks it up (verified on Docker Desktop for Mac; on Linux the files are owned by uid 1000). Mount any other path at `/data` if you prefer |

Without compose: `docker build -t quack-aloud .` then `docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... -v $PWD/data:/data quack-aloud`.

Kubernetes: `deploy/k8s/quack-aloud.yaml` is a minimal Deployment + Service + PVC. State is files, so it runs as one replica with a ReadWriteOnce volume (`strategy: Recreate`), and the API key comes from a Secret. Put it behind an Ingress with authentication before exposing it: every message costs API credit. `fs.watch` (which drives live updates) does not fire on some network filesystems; use a block volume, not NFS. The coding-agent routes need the files on the same machine as the agent, so they are for local Docker, not for a cluster.

## Using a coding agent as the duck (no API key)

Claude Code and Google Antigravity can play the duck by editing the open project file directly. The canvas and the in-app chat update live, and the cost is the agent's own plan, not an API key.

| Step | Claude Code | Antigravity | Note |
|---|---|---|---|
| 1 | Open this folder in Claude Code (the Code tab in the Claude app, or `claude` in a terminal) | Open this folder as the workspace | Claude Code loads `CLAUDE.md`; Antigravity loads `.agents/rules/quack-aloud.md`. Both hold the same rules and file format |
| 2 | `npm run dev` and open http://localhost:5173 | same | The agent finds the open project through `http://localhost:8787/api/projects` |
| 3 | Type the thought, plainly or as `/duck <thought>` | `/duck <thought>` in the agent panel | `/duck` makes the intent explicit; a plain message in Claude Code works too. The command list is read when a session starts, so after cloning or pulling, start a new session before `/duck` shows up |
| 4 | Add "guide", "引導", or "質疑" to the message for questions and challenges | same | Without it the agent only organises |
| 5 | Say "new project: <name>" / "開新專案：<名稱>" for a fresh project, or "new canvas: <name>" / "開新畫布：<名稱>" for another canvas in the open project | same | The agent creates the folder or file under `data/projects/` and files the rest of the message there. Switch to it in the pickers |

Both routes and the in-app chat write the same files, so they can be mixed. Avoid dragging cards in the browser at the exact moment the agent writes the file; the browser refuses the stale write and shows "canvas changed elsewhere".

## Configuration (`.env`)

| Key | Default | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Required for the `claude` provider |
| `PROVIDER` | `claude` | **Optional**. Name registered in `server/providers/index.ts` |
| `CLAUDE_MODEL` | `claude-opus-5` | **Optional** |
| `CLAUDE_EFFORT` | `medium` | **Optional**. `low` / `medium` / `high` / `xhigh` / `max`. Higher is slower and costs more |
| `API_PORT` | `8787` | **Optional**. The Vite dev server proxies `/api` to this port |
| `DATA_DIR` | `./data` | **Optional**. Folder holding `projects/` and `trash/`. The Docker image sets `/data` |

## Projects and canvases

A project is a folder of canvases: a novel might have "Concept", "Characters", and "Chapter 1"; each canvas has its own cards and chat.

| Control | Where | What it does | Note |
|---|---|---|---|
| Project › Canvas pickers | Top bar, next to the title | Pick a project, then one of its canvases | The last opened canvas is remembered per browser. Picking a project opens its most recent canvas |
| + New project… / + New canvas… | Last entries of each picker | Type a name, Enter | A new project starts with one empty canvas called "Main" |
| Rename… / Delete… | Last entries of each picker | Rename inline; Delete asks once, inline | Deleted projects and canvases move to `data/trash/`, not removed; copy them back to restore. Deleting a project's last canvas creates a fresh empty one; deleting the last project creates a fresh project |

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
| Talk to the duck | "Talk to the duck" at the bottom of the chat opens a full-screen stage: a big duck, its latest reply under it, and a large box where you type or dictate. Enter sends (the stage stays open and the duck answers there), Shift+Enter is a new line, Esc goes back to the canvas |
| Dictation | "Speak" on the stage uses the browser's speech recognition (Chrome, Edge, Safari). The duck bobs and grows with your voice and the words appear in the box as you talk. Pick the language next to the button (Default: 中文（台灣） on a Chinese browser, otherwise the browser's language); the choice is remembered. Hidden where the API is not available |

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
| Save a copy | "Export" (top right). Downloads the current canvas, chat included, as `quack-aloud-<project>-<canvas>-<date>.json` |
| Load a copy | "Import" (top right). Creates a new canvas in the current project from an exported file and switches to it; nothing is overwritten. Any valid canvas file works, including one written by hand |
| Start over | "Clear" (top right), then confirm with "Really clear everything?". Empties the current canvas but keeps it |
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
| `npm start` | Serve API and the built UI from one process on `API_PORT` (run `npm run build` first) |
| `npm run docker:build` / `npm run docker:run` | Build the image / build and start with compose |
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
| A project or canvas vanished from the pickers | Its folder or file was deleted or renamed to something other than lowercase letters, digits, and dashes; or a project folder lost its `project.json` | Put it back under `data/projects/<pid>/` with a valid name |
| Claude Code says "Unknown command: /duck" | The session started before `.claude/commands/duck.md` existed; commands are read at session start | Start a new session, or type the thought without `/duck` (CLAUDE.md already tells Claude Code how to file it) |
| `/duck` does nothing in Antigravity | `.agents/workflows/duck.md` not picked up | Check the folder is the workspace root; the older `.agent/` name is also accepted |

## License

MIT. See [LICENSE](LICENSE).
