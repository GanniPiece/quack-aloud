# Developing Quack Aloud

The browser is React + Vite + React Flow. Express serves the REST API, SSE updates, and HTTP MCP. Canvas JSON files under `DATA_DIR/projects/<pid>/<cid>.json` are the source of truth; `server/projects.ts` owns persistence. `shared/graph.ts` defines canvas types; `server/graph.ts` merges structured turns.

- Run `npm install`, `npm run dev` (UI :5173, API :8787). `npm run build` typechecks and builds the UI. `npm start` serves the built UI and API together.
- Browser LLM calls go through `ThinkProvider` in `server/providers/`; never call an SDK in route handlers. Claude and OpenAI receive the same prompt from `server/prompt.ts` and return `ThinkOutputSchema`.
- External Claude Code, Codex, and Antigravity sessions use MCP or the local-file fallback described in [duck-guide.md](duck-guide.md). They are independent of the browser's provider selection and API key.
- UI strings are English; use the DuckIcon SVG rather than emoji.
- Preserve user data and credentials. Do not commit `.env`, personal projects, account files, API keys, or MCP tokens. Use a temporary DATA_DIR and disable dotenv loading for tests; never test writes against personal canvases.
- Run `npm test` for behavioral changes and `npm run build` for TypeScript/UI changes. Provider tests should mock the network while exercising the SDK's actual schema conversion/parsing. Test both providers and legacy settings migration when changing configuration.
- Keep README.md and README.zh-TW.md aligned. Shared duck rules belong in duck-guide.md; client-specific instructions stay in each agent entry point. Runtime prompt changes must remain consistent with those rules.
