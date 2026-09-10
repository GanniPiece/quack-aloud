# Quack Aloud

> status: MVP, shared canvases, local or self-hosted

中文版：[README.zh-TW.md](README.zh-TW.md)

Quack Aloud is rubber-duck debugging with a canvas: you think out loud to a duck, and it files what you say as cards, themes, and relations on an infinite canvas next to the chat. Switch on **AI guidance** and it also asks questions and pushes back, in cards marked as its own. This document is for anyone running or extending the app.

Agent workflow and file fallback: see [the shared duck guide](docs/duck-guide.md). Setup for all three agents: see [Agent setup](#agent-setup).

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
| `data/projects/<pid>/` | One folder per project: `project.json` (name) and one file per canvas `<cid>.json` with themes, cards, relations, chat history, layout | Single source of truth. Every writer (chat API, browser edits, coding agents, a text editor) writes these files. Older layouts (`data/graph.json`, flat `data/projects/<id>.json`) are migrated on startup |
| `server/` | Express API on `API_PORT` | Watches `data/projects/` and pushes every change to browsers over SSE (`/api/events`) |
| `server/providers/` | LLM backends | Swappable via `PROVIDER`. `claude` (Anthropic API) and `openai` (OpenAI Responses API) are implemented |
| `src/` | Vite + React + React Flow UI | Chat on the left, canvas on the right |
| `server/mcp.ts`, `server/mcpHttp.ts` | The duck as an MCP server: five tools, over stdio or at `/mcp` over HTTP | Lets Claude Code, Codex, Antigravity, or any MCP client file cards through `duck_turn` on the agent's own plan, no API key. See "MCP server" below |
| `AGENTS.md`, `CLAUDE.md`, `.agents/` | Coding-agent instructions | Codex uses `AGENTS.md` and `$duck`; Claude Code and Antigravity use `/duck`. All read [the shared duck guide](docs/duck-guide.md), prefer MCP, and support a local-file fallback |

## Getting started

Requires Node.js 22 or newer and npm. The Docker image includes Node.js 22.

1. `npm install`
2. `cp .env.example .env`
3. `npm run dev`
4. Open http://localhost:5173 and create the Quack Aloud owner account (or sign in). This website account is separate from any AI provider account
5. As owner, open **Settings** and choose `claude` (default) or `openai`, then paste the corresponding Anthropic or OpenAI API key and Save. Browser chat is billed to that API account, separately from Claude/ChatGPT/Codex subscriptions. Keys stay on the server in `data/settings.json`; `.env` also supports `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`
6. Type something like "The home page loads slowly, I think it's the database" and press Enter. You should see two yellow cards inside a tinted theme container, an edge between them, and a one-line reply saying what was filed
7. Switch on **AI guidance** (top of the chat) and send another thought. You should now also see one or two dashed blue cards from the duck and a short conversational reply

To try the canvas without an API key, use "Import" (top right of the canvas) on `data/sample-graph.json`; it becomes a new project.

## Run with Docker

One image serves the API and the built UI on port 8787; projects live on a volume.

| Step | Command | Note |
|---|---|---|
| 1 | `cp .env.example .env` and set `PROVIDER` and its `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | The container reads `.env` through `docker compose` |
| 2 | `docker compose up --build` | Builds the image and starts it; open http://localhost:8787 |
| 3 | Data is the same `./data/` folder the dev server uses | `projects/`, `trash/`, backups. The Claude Code, Codex, and Antigravity routes keep working: they use MCP or edit `data/projects/<pid>/<cid>.json` on the host and the container's watcher picks it up (verified on Docker Desktop for Mac; on Linux the files are owned by uid 1000). Mount any other path at `/data` if you prefer |

Without compose: `docker build -t quack-aloud .` then `docker run -p 8787:8787 -e ANTHROPIC_API_KEY=... -v $PWD/data:/data quack-aloud`.

For OpenAI without compose, add `-e PROVIDER=openai -e OPENAI_API_KEY=...` in place of the Anthropic key. No Codex executable or login is needed inside the image.

Kubernetes: `deploy/k8s/quack-aloud.yaml` is a minimal Deployment + Service + PVC. State is files, so it runs as one replica with a ReadWriteOnce volume (`strategy: Recreate`), and the API key comes from a Secret. Put it behind an Ingress with authentication before exposing it: every message costs API credit. `fs.watch` (which drives live updates) does not fire on some network filesystems; use a block volume, not NFS. Agent stdio/file routes need local access to the data. Remote agents can use the authenticated HTTP MCP endpoint for a cluster.

## Using a coding agent as the duck (no browser API key)

Claude Code, Codex, and Google Antigravity can file thoughts through MCP using their own account and usage limits. Browser chat separately uses the selected Claude or OpenAI API provider; selecting `openai` does not start Codex or use a ChatGPT subscription. All three agents share [duck rules and the local-file fallback](docs/duck-guide.md).

| Setup | Claude Code | Codex | Antigravity |
|---|---|---|---|
| Project instructions | `CLAUDE.md` | `AGENTS.md` | `.agents/rules/quack-aloud.md` |
| Explicit duck invocation | `/duck <thought>` | `$duck <thought>` | `/duck <thought>` |
| Command / skill file | `.claude/commands/duck.md` | `.agents/skills/duck/SKILL.md` | `.agents/skills/duck/SKILL.md` |
| Checked-in local MCP config | `.mcp.json` | `.codex/config.toml` | Add the entry below through the MCP settings |

### MCP server (recommended for agents)

The app provides five tools: `list_projects`, `read_canvas`, `create_project`, `create_canvas`, and `duck_turn`. The agent reads the canvas and decomposes the thought; `duck_turn` applies the same placement, id handling, hierarchy, history, and guidance filtering as browser chat. Its instructions include the same organising rules as `server/prompt.ts`.

| Transport | Use it when | Lifecycle and authentication |
|---|---|---|
| **Local stdio** | The agent can access this checkout and the app's data directory | The client starts a child process. No website session, browser API key, or MCP token is needed. The app may be stopped |
| **HTTP** at `/mcp` | The app runs locally, in Docker, or remotely, including Kubernetes | The app serves the endpoint on `API_PORT` (8787 by default). Requires its MCP bearer token; no separate MCP process to start |
| **Docker stdio** | Docker runs locally and you want the child process inside its running container | The client starts `docker compose exec -T …`; uses the container's `/data`. No Node installation on the host or MCP token needed |

<a id="codex-setup"></a>
### Agent setup

The steps below cover all three clients. Install and authenticate your chosen agent first using its normal setup. Its login is independent of Quack Aloud's website account and browser API keys.

#### Local first use

1. From the repository root, run `npm install`, then `npm run dev`.
2. Open http://localhost:5173 and create/sign into the **Quack Aloud** website account to view the canvas. A browser provider key is optional when thoughts are submitted through an external agent.
3. Open this checkout in your agent and configure local MCP using its instructions below. For a custom data directory, give the MCP process the same absolute `DATA_DIR` as the app.
4. Check the connection, then submit a thought with the client's duck invocation. Name the project/canvas when several exist; MCP cannot see the browser selection, and recent updates are only a heuristic.

The agent starts the stdio child process; do not run `npm run mcp` in another terminal. The app is needed to see live updates, but stdio can file thoughts while it is stopped.

##### Claude Code — local

1. Start Claude Code **from this repository root** so `.mcp.json` resolves `server/mcp.ts` correctly. It already registers `quack-aloud`; approve the project/server when prompted.
2. Open `/mcp` and check `quack-aloud`. Start a fresh session if the newly added `.claude/commands/duck.md` has not loaded.
3. Send `/duck The homepage is slow; I suspect the database. Guide me.`

`CLAUDE.md` supplies project instructions. No additional `claude mcp add` is needed for the checked-in stdio configuration. See [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp) for scopes and approvals.

##### Codex — local

1. Open and trust this repository. `.codex/config.toml` registers `quack-aloud` using `npm run --silent mcp`; npm finds the package root even from a subdirectory.
2. Restart Codex after initial configuration if the server or skill has not loaded. In the CLI, `/mcp` checks the connection; `/skills` or `$` selects skills. `codex mcp get quack-aloud --json` inspects configuration, not a live connection.
3. Send `$duck The homepage is slow; I suspect the database. Guide me.`

`AGENTS.md` supplies project instructions, and `.agents/skills/duck/SKILL.md` supplies the skill. `$duck` is not a native `/duck` slash command. See [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), [project instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md), and [skills](https://learn.chatgpt.com/docs/build-skills).

##### Antigravity — local

1. Open this repository as the workspace, or run `agy` from its root. In MCP settings, open the custom server configuration. In the IDE: agent panel **… → MCP Servers → Manage MCP Servers → View raw config**; other surfaces expose MCP under Customizations.
2. Merge this entry into `mcpServers` in the configuration opened by the client; replace the checkout path:

   ```json
   {
     "mcpServers": {
       "quack-aloud": {
         "command": "npm",
         "args": ["run", "--silent", "mcp"],
         "cwd": "/absolute/path/to/quack-aloud"
       }
     }
   }
   ```

3. Reload the MCP configuration and check that the server's five tools are available. Start a fresh agent conversation if the workspace rules/skill have not loaded, then send `/duck The homepage is slow; I suspect the database. Guide me.`

The repo supplies `.agents/rules/quack-aloud.md` and `.agents/skills/duck/SKILL.md`; it does not pre-register an Antigravity MCP entry. Preserve other servers when editing the configuration. See [Antigravity MCP configuration](https://antigravity.google/docs/mcp/).

Alternatively, register local stdio through the Antigravity CLI from the repository root:

```sh
agy mcp add --env "DATA_DIR=$PWD/data" quack-aloud npx -y tsx "$PWD/server/mcp.ts"
```

Use the app's actual `DATA_DIR` if it differs. The command stores absolute paths so it can launch from other directories. Check the registered server with `agy mcp list` and its live connection with `/mcp`.

For every client, guidance is off unless requested with words such as "guide", "引導", or "質疑"; the browser toggle does not set an external agent's mode. Request "new project: <name>" / "開新專案：<名稱>" or "new canvas: <name>" / "開新畫布：<名稱>" to create one, then select it in the browser picker. Natural-language requests to file thoughts can use the same workflow. Requests to explain or modify the app are development work.

#### HTTP, Docker, and remote installations

These steps apply to all three agents:

1. Start the target app. Docker Compose uses `docker compose up` and http://localhost:8787; a remote/Kubernetes installation needs an externally reachable HTTPS URL. Use the API endpoint ending in `/mcp`, not a canvas URL or `/api`.
2. Sign into that installation as **owner**, open **Settings → MCP access**, and copy its endpoint and token. The token grants read/write access to every project. `MCP_TOKEN` can pin it; otherwise the app generates one and lets the owner rotate it.
3. Configure **one transport for `quack-aloud`** with the client-specific steps below. Keep deployment-specific changes local and never commit a real token. For an agent on another machine, replace `localhost` with the app's reachable host and use HTTPS.
4. Reconnect/restart the client and check tools before filing a thought. HTTP needs the app running; it does not need Node or this app's dependencies on the agent's machine. Keep the repo open to retain its instructions and duck command/skill; adding MCP alone does not install those files in another workspace.

Quack Aloud uses a fixed bearer token for MCP, not an OAuth sign-in flow. Website cookies and provider API keys cannot substitute for this token. After rotation, update every HTTP client and reconnect.

##### Claude Code — HTTP

From this repository root, use **Settings → MCP access → Claude Code → copy the add command**, or replace the placeholders here:

```sh
claude mcp add --scope local --transport http quack-aloud https://your-quack-host/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Local scope overrides this checkout's project `.mcp.json` entry. If a local entry already exists, update that entry rather than adding a duplicate. The copied command contains the token: keep it private and out of shared scripts. Restart/reconnect and check `/mcp`.

Alternatively, replace only `quack-aloud` in the project's `.mcp.json` with this entry, preserving other servers:

```json
{
  "mcpServers": {
    "quack-aloud": {
      "type": "http",
      "url": "https://your-quack-host/mcp",
      "headers": { "Authorization": "Bearer ${QUACK_ALOUD_MCP_TOKEN}" }
    }
  }
}
```

Set `QUACK_ALOUD_MCP_TOKEN` in Claude Code's launch environment. A local-scope entry takes precedence over this project entry; inspect `claude mcp get quack-aloud` if the wrong transport loads. Claude supports variable expansion in these headers. [Claude MCP reference](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcp-json).

##### Codex — HTTP

Choose **Settings → MCP access → Codex → copy HTTP config**. In this repository, replace the `[mcp_servers.quack-aloud]` table in `.codex/config.toml`; remove the stdio `command` and `args`:

```toml
[mcp_servers.quack-aloud]
url = "https://your-quack-host/mcp"
bearer_token_env_var = "QUACK_ALOUD_MCP_TOKEN"
```

Set `QUACK_ALOUD_MCP_TOKEN` in Codex's launch environment, then restart/reconnect. A shell variable is not automatically visible to a desktop app launched elsewhere. The config contains the variable name, not the token.

For another workspace without this project's configuration, **copy the add command** supplies the equivalent of:

```sh
codex mcp add quack-aloud --url https://your-quack-host/mcp --bearer-token-env-var QUACK_ALOUD_MCP_TOKEN
```

This adds user-level configuration. Project configuration takes precedence, so this command alone does not replace the repo's stdio table. It registers tools; `$duck` remains repository-scoped unless installed separately. [Codex MCP reference](https://learn.chatgpt.com/docs/extend/mcp).

##### Antigravity — HTTP

Use **Settings → MCP access → Antigravity → copy the add command**, or replace the placeholders below:

```sh
agy mcp add --header "Authorization: Bearer <MCP_TOKEN>" quack-aloud https://your-quack-host/mcp
```

Place flags before the server name; the CLI detects the HTTP URL. The shared personal configuration is `~/.gemini/config/mcp_config.json`. The IDE also exposes it through its MCP settings. If `quack-aloud` is already registered locally, update that entry to use HTTP. [Antigravity MCP configuration](https://antigravity.google/docs/cli/mcp/).

Alternatively, edit the MCP configuration opened through the client and replace the local `quack-aloud` entry with the following. Use the **personal/global configuration** when storing a token, and preserve other servers:

```json
{
  "mcpServers": {
    "quack-aloud": {
      "serverUrl": "https://your-quack-host/mcp",
      "headers": { "Authorization": "Bearer <MCP_TOKEN>" }
    }
  }
}
```

Replace `<MCP_TOKEN>` with the token from the target installation, remove that entry's stdio `command`, `args`, and `cwd`, then reload and check tools. Remove or update any conflicting workspace entry. Antigravity uses `serverUrl` for remote servers; this example stores a literal token, so keep the configuration private. [Antigravity MCP reference](https://antigravity.google/docs/mcp/).

##### Gemini CLI — HTTP

Other MCP clients can use the same endpoint. For Gemini CLI, replace the placeholders and register it in user settings:

```sh
gemini mcp add -s user -t http -H "Authorization: Bearer <MCP_TOKEN>" quack-aloud https://your-quack-host/mcp
```

Check the connection with `/mcp`, then use `list_projects` and `read_canvas`. Refer to `docs/duck-guide.md` when filing thoughts. [Gemini CLI MCP configuration](https://geminicli.com/docs/tools/mcp-server/).

##### Docker stdio — all three clients

HTTP above is sufficient for Docker. If you prefer stdio, start `docker compose up` first and replace the existing server entry using the following. Docker must be available on the agent's machine. Replace `/absolute/path/to/quack-aloud` with the actual Compose project path; `-T` is required for MCP stdio.

For **Claude Code** (`.mcp.json`) or **Antigravity** (its custom MCP configuration), merge this JSON entry:

```json
{
  "mcpServers": {
    "quack-aloud": {
      "command": "docker",
      "args": ["compose", "--project-directory", "/absolute/path/to/quack-aloud", "exec", "-T", "quack-aloud", "npm", "run", "--silent", "mcp"]
    }
  }
}
```

For **Codex**, replace the table in `.codex/config.toml`:

```toml
[mcp_servers.quack-aloud]
command = "docker"
args = ["compose", "--project-directory", "/absolute/path/to/quack-aloud", "exec", "-T", "quack-aloud", "npm", "run", "--silent", "mcp"]
```

Remove HTTP fields when switching to stdio and check for overriding entries in the client's other scopes. The child process writes the running container's `/data`. The existing `.mcp.docker.json` is a Claude-compatible alternative for launching from the repo root; its filename is not auto-loaded in place of `.mcp.json`. Use its entry to replace the active one.

For Kubernetes or another remote host, use HTTP rather than the local Docker command. Host stdio/file access works only when it reaches the intended data directory. With custom local storage, set `DATA_DIR` in the stdio entry's `env` (JSON clients), or `[mcp_servers.quack-aloud.env]` (Codex), to the same absolute path as the app. An unreachable remote endpoint is not a reason to file thoughts into a different local installation.

#### Instructions and accounts

| Item | Purpose |
|---|---|
| `CLAUDE.md`, `AGENTS.md`, `.agents/rules/` | Agent-specific project instructions |
| `.claude/commands/`, `.agents/skills/` | Claude commands and the shared Codex/Antigravity duck skill |
| `docs/duck-guide.md` | Shared organising rules and local-file fallback |
| `docs/development.md` | Shared instructions for changing the application |
| `server/prompt.ts` | Runtime instructions sent to browser providers and advertised by MCP |
| Quack Aloud email/password | Website access; all signed-in users share projects |
| Anthropic/OpenAI API key | Pays for the corresponding browser provider; stored server-side |
| Claude Code / Codex / Antigravity login | Authenticates the external agent; independent of browser settings |
| MCP bearer token | Authorises HTTP tools to read/write all projects on that installation |

Neither browser provider automatically reads AGENTS.md or CLAUDE.md. Codex and Antigravity share `.agents/skills/duck/SKILL.md`, while their project instructions remain in `AGENTS.md` and `.agents/rules/quack-aloud.md`, respectively. Configure MCP once per client/target installation, then reuse it; reconnect after changing its configuration or credentials. Registering an MCP server and loading a duck command/skill are separate steps.

#### Troubleshooting and testing

| Problem | Check |
|---|---|
| Claude `/duck` missing | Open this repo and start a fresh conversation so `.claude/commands/duck.md` loads |
| Codex skill missing | Use `$duck` or `/skills`; confirm `.agents/skills/duck/SKILL.md` is present and restart if discovery has not refreshed |
| Antigravity `/duck` missing | Open this repo as the workspace and check `.agents/skills/duck/SKILL.md`; reload/start a fresh conversation |
| MCP missing or disconnected | Claude: `/mcp` and `claude mcp get quack-aloud`. Codex: `/mcp` and `codex mcp get quack-aloud --json`. Antigravity: `agy mcp list`, `/mcp`, and its connection logs. Verify trust/approval, executable paths, and dependencies |
| Wrong transport/endpoint | Check the effective server entry and conflicting scopes; choose one intended installation |
| HTTP 401 | Check the target installation's token, launch environment or header, and reconnect after rotation; do not use the website password or provider API key |
| Docker stdio fails | Confirm Compose is running, Docker is available, the project path is correct, and `-T` is present |
| Wrong canvas or no live update | Name the project/canvas; match the endpoint or DATA_DIR and select that canvas in the browser. The running app must watch the same files |
| Browser says no API key | External agents can still file cards. Browser chat requires the owner to select a provider and enter its key |

Start verification with `list_projects` and `read_canvas`. For a write test, use a disposable installation/DATA_DIR and a test canvas. `npm test` covers tool logic, in-memory MCP protocol, authenticated HTTP, and the stdio command used by Codex, as well as providers/settings. Manual protocol inspection: `npx @modelcontextprotocol/inspector` with the HTTP endpoint and bearer header, or the stdio command.

All routes write the same canvas files. Avoid dragging cards at the exact moment an agent writes: the browser rejects stale edits with "canvas changed elsewhere". Return the saved `duck_turn` reply; do not apply the same turn again by editing JSON. Local-file fallback instructions are in [the shared duck guide](docs/duck-guide.md).

## Sign-in

This is a **Quack Aloud website account**, not Claude, OpenAI, or Codex login. The app asks for an account (email + password), because the API key behind it pays for every message. Accounts control the door, not the data: everyone who can sign in shares the same projects.

| Situation | What happens | Note |
|---|---|---|
| First visit, no accounts yet | "Create the owner account": email and a password of 8 characters or more | Stored as scrypt hashes in `data/users.json` (owner-only file). Never commit or share it |
| Later visits | "Sign in" with email and password | The session is an HttpOnly cookie valid for 30 days; five wrong attempts lock that address for 30 seconds |
| More people | Settings › Accounts (owner only): add an email and a starting password, or remove an account | The last owner cannot be removed |
| Containers, Kubernetes | Set `APP_EMAIL` and `APP_PASSWORD` in the environment | Seeds the owner account on first start; ignored once any account exists |
| Change your password | Settings › Change password | Ends your other sessions; other accounts are not affected |
| Sign out | Your email · "Sign out" in the top bar | |
| No sign-in wanted | `AUTH_DISABLED=1` | Only on a machine nobody else can reach |
| Behind a reverse proxy | `TRUST_PROXY=1` | So cookies are marked Secure over HTTPS and rate limiting sees the real address |

External Claude Code, Codex, and Antigravity sessions use a separate route: local stdio/file access needs no website session; HTTP MCP needs its bearer token. Viewing the canvas in a browser still requires website sign-in. Only the owner can change shared AI settings and manage accounts/MCP tokens.

## Configuration

The owner sets provider, API key, model, and effort in **Settings** (top right; also reachable from the "no key" notice in the chat). They are stored in `data/settings.json` with owner-only permissions and take effect at once, no restart. Anything not set there falls back to `.env`:

| Key | Default | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | | Key for the `claude` provider when none is saved in Settings |
| `PROVIDER` | `claude` | **Optional**. `claude` or `openai`, registered in `server/providers/index.ts` |
| `OPENAI_API_KEY` | | Key for `openai` when none is saved in Settings |
| `OPENAI_MODEL` | `gpt-5.4-mini` | **Optional**. Must support Responses structured outputs and the selected reasoning effort |
| `OPENAI_EFFORT` | `medium` | **Optional**. `none` / `low` / `medium` / `high` / `xhigh` for the default model; `max` is not sent to OpenAI |
| `CLAUDE_MODEL` | `claude-opus-5` | **Optional** |
| `CLAUDE_EFFORT` | `medium` | **Optional**. `low` / `medium` / `high` / `xhigh` / `max`. Higher is slower and costs more |
| `API_PORT` | `8787` | **Optional**. The Vite dev server proxies `/api` to this port |
| `DATA_DIR` | `./data` | **Optional**. Folder holding `projects/` and `trash/`. The Docker image sets `/data` |

Keys, models, and efforts are remembered separately for each provider. Save before switching providers; changing the selector loads that provider's saved/default values and clears an unsaved key. Existing installations keep their selected provider and credentials: legacy shared model/effort fields are attributed to their previous provider on read and the new shape is persisted on the next Settings save. Saved settings take precedence over `.env`; changing only `PROVIDER` there does not override a saved selection.

The OpenAI adapter uses the Responses API with `ThinkOutputSchema` as structured output and `store: false`; the app keeps canvas history locally. This is not a claim of zero server-side retention. Other OpenAI models may support different effort values; check their model documentation. Sources: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [default model](https://developers.openai.com/api/docs/models/gpt-5.4-mini).

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
| Map / Timeline | Top bar | **Map**: the free-form canvas. **Timeline**: the same cards grouped by the turn that created them, in the order you said them | Both read the same canvas file; the choice is remembered per browser |
| Layout (on the map) | Top right of the canvas | How cards are arranged. **Auto** (Default) follows the duck's suggestion for the content; or pin one: **Themes** (one column per theme with containers), **Layered** (ranked left-to-right by edge direction, for cause/effect and dependencies), **Timeline** (a numbered time axis through the events, with labelled swim lanes: people and things above, claims and beliefs below, the duck's notes at the bottom; for stories and processes), **Mind map** (a tree spreading from the central concept, for knowledge; hierarchy relations such as "kind of", "part of", 屬於 are followed first, so intermediate concept cards become the levels) | Changing it re-arranges the canvas right away. With "Auto" on (Default), every batch of cards added by the duck or an agent re-arranges the canvas in the current layout |

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
| Re-lay out everything | "Tidy" (top right), in the current layout. "Auto" next to it (Default: on) does this by itself whenever the duck or a coding agent adds cards; cards you add by hand and your drags never trigger it. Turn it off to keep a hand-made arrangement |
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
| `npm run mcp` | Start the MCP server on stdio (for MCP clients; not something to run by hand) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest tests for providers, settings migration/switching, graph merge, prompts, layouts, authentication, and MCP transports (including Codex stdio). `npm run test:watch` re-runs on change |

## Adding another LLM provider

1. Create `server/providers/<name>.ts` implementing `ThinkProvider` from `server/providers/types.ts`. `think()` receives the assembled system prompt, recent history, and the user turn, and must return an object matching `ThinkOutputSchema`
2. Register it in `REGISTRY` in `server/providers/index.ts`; add defaults/efforts in `server/providerConfig.ts` and environment mappings in `server/settings.ts`
3. Add that SDK's error mapping to `describeProviderError` in the same file
4. Update `.env.example`, both READMEs, and tests. Select it in Settings (saved selection wins), or set `PROVIDER=<name>` in `.env` when no selection is saved

The prompt itself lives in `server/prompt.ts` and is shared by all providers.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Chat says "No API key for provider" | No key saved in Settings and none in `.env` | Open Settings and paste the key; no restart needed |
| Top-right pill says "disconnected" | API server not running or on a different port | Check the `[server]` lines in the terminal; match `API_PORT` |
| Canvas empty after editing a project file by hand | Invalid JSON, or nodes missing `id` / `label` | The server skips unreadable files and drops bad entries; fix the JSON and save again |
| A project or canvas vanished from the pickers | Its folder or file was deleted or renamed to something other than lowercase letters, digits, and dashes; or a project folder lost its `project.json` | Put it back under `data/projects/<pid>/` with a valid name |
| Codex does not show the duck skill | Skill/config not loaded, or `/duck` used | Use `$duck` or `/skills` in CLI/IDE; restart after first setup. See [Agent setup](#agent-setup) |
| Claude Code says "Unknown command: /duck" | The session started before `.claude/commands/duck.md` existed; commands are read at session start | Start a new session, or type the thought without `/duck` (CLAUDE.md already tells Claude Code how to file it) |
| `/duck` does nothing in Antigravity | `.agents/skills/duck/SKILL.md` not picked up | Check the folder is the workspace root (for `agy`, the folder you ran it in); the older `.agent/` name is also accepted. `agy -p /skills --add-dir .` lists what it found (without `--add-dir`, print mode answers before the workspace is scanned) |

## License

MIT. See [LICENSE](LICENSE).
