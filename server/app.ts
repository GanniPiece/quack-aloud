import "dotenv/config";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { emptyGraph, graphSignature, type Graph } from "../shared/graph";
import { DATA_DIR, applyThinkResult, normalize } from "./graph";
import {
  PROJECTS_DIR,
  createCanvas,
  createProject,
  defaultCanvas,
  deleteCanvas,
  deleteProject,
  ensureMigrated,
  ensureOneProject,
  isValidId,
  listProjects,
  loadCanvas,
  projectExists,
  renameCanvas,
  renameProject,
  saveCanvas,
} from "./projects";
import {
  authDisabled,
  changePassword,
  clearSessionCookie,
  createUser,
  currentUser,
  deleteUser,
  hasUsers,
  issueSession,
  listUsers,
  loginLocked,
  recordLogin,
  requireAuth,
  seedFromEnv,
  setSessionCookie,
  validateEmail,
  validatePassword,
  verifyLogin,
} from "./auth";
import { buildThinkInput } from "./prompt";
import { PROVIDER_NAMES, RefusalError, describeProviderError, getProvider } from "./providers";
import { EFFORTS, maskKey, resolveConfig, updateSettings, type Effort } from "./settings";

import { mcpToken, mcpTokenSource, mountMcp, rotateMcpToken } from "./mcpHttp";

/**
 * Builds the Express app: auth, REST API, SSE, the MCP endpoint, and (in production) the built UI.
 * index.ts listens; tests call this directly.
 */
export function createApp() {
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
app.use(express.json({ limit: "8mb" }));

fs.mkdirSync(DATA_DIR, { recursive: true });
ensureMigrated();
ensureOneProject();

// ---------- auth ----------
// Accounts (email + password) and a signed session cookie. The first account, created on the
// first visit or seeded from APP_EMAIL / APP_PASSWORD, is the owner and manages the others.
// Every /api route below except these needs a session; static files are served regardless
// because the sign-in screen is part of the same page.

if (seedFromEnv()) console.log(`[auth] created the owner account from APP_EMAIL`);

app.get("/api/auth/status", (req, res) => {
  const user = currentUser(req);
  res.json({ authRequired: !authDisabled(), configured: hasUsers(), user: user ? { email: user.email, role: user.role } : null });
});

/** First run: create the owner account. Refused once any account exists. */
app.post("/api/auth/setup", (req, res) => {
  if (authDisabled()) {
    res.status(400).json({ error: "Authentication is disabled (AUTH_DISABLED)." });
    return;
  }
  if (hasUsers()) {
    res.status(409).json({ error: "An account already exists. Sign in; the owner can add accounts in Settings." });
    return;
  }
  const problem = validateEmail(req.body?.email) ?? validatePassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  const user = createUser(req.body.email, req.body.password, "owner");
  setSessionCookie(req, res, issueSession(user.id));
  res.status(201).json({ ok: true, user: { email: user.email, role: user.role } });
});

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  const wait = loginLocked(ip);
  if (wait > 0) {
    res.status(429).json({ error: `Too many attempts. Try again in ${wait}s.` });
    return;
  }
  const email = typeof req.body?.email === "string" ? req.body.email : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = email && password ? verifyLogin(email, password) : null;
  recordLogin(ip, user !== null);
  if (!user) {
    res.status(401).json({ error: "Wrong email or password." });
    return;
  }
  setSessionCookie(req, res, issueSession(user.id));
  res.json({ ok: true, user: { email: user.email, role: user.role } });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/** Change your own password: needs the current one. Ends your other sessions. */
app.post("/api/auth/password", (req, res) => {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue.", authRequired: true });
    return;
  }
  if (!(typeof req.body?.current === "string" && verifyLogin(user.email, req.body.current))) {
    res.status(401).json({ error: "Current password is wrong." });
    return;
  }
  const problem = validatePassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  changePassword(user.id, req.body.password);
  setSessionCookie(req, res, issueSession(user.id));
  res.json({ ok: true });
});

// ----- account management (owner only) -----

function requireOwner(req: Request, res: Response) {
  const user = currentUser(req);
  if (!user) {
    res.status(401).json({ error: "Sign in to continue.", authRequired: true });
    return null;
  }
  if (user.role !== "owner") {
    res.status(403).json({ error: "Only the owner can manage accounts." });
    return null;
  }
  return user;
}

app.get("/api/auth/users", (req, res) => {
  if (!requireOwner(req, res)) return;
  res.json(listUsers());
});

app.post("/api/auth/users", (req, res) => {
  if (!requireOwner(req, res)) return;
  try {
    const user = createUser(String(req.body?.email ?? ""), String(req.body?.password ?? ""), req.body?.role === "owner" ? "owner" : "member");
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete("/api/auth/users/:id", (req, res) => {
  const me = requireOwner(req, res);
  if (!me) return;
  if (req.params.id === me.id) {
    res.status(400).json({ error: "You cannot remove your own account." });
    return;
  }
  const problem = deleteUser(req.params.id);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  res.json({ ok: true });
});

app.use(requireAuth);

// ---------- SSE: push changes to browsers ----------
// event "graph":    { project, canvas, graph } whenever a canvas file changes
// event "projects": the project tree whenever anything is added, removed, renamed, or saved

const sseClients = new Set<Response>();

function send(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastGraph(project: string, canvas: string, graph: Graph) {
  for (const res of sseClients) send(res, "graph", { project, canvas, graph });
}

function broadcastProjects() {
  const list = listProjects();
  for (const res of sseClients) send(res, "projects", list);
}

app.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.add(res);
  send(res, "projects", listProjects());
  const { project, canvas } = req.query;
  if (isValidId(project) && isValidId(canvas)) {
    const g = loadCanvas(project, canvas);
    if (g) send(res, "graph", { project, canvas, graph: g });
  }
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Watch data/projects recursively: whoever edits a file (server, Claude Code, an editor), broadcast it
const watchTimers = new Map<string, NodeJS.Timeout>();
fs.watch(PROJECTS_DIR, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const parts = String(filename).split(path.sep);
  const key = parts.join("/");
  clearTimeout(watchTimers.get(key));
  watchTimers.set(
    key,
    setTimeout(() => {
      watchTimers.delete(key);
      try {
        if (parts.length === 2 && parts[1].endsWith(".json") && parts[1] !== "project.json") {
          const [pid, file] = parts;
          const cid = file.slice(0, -5);
          if (isValidId(pid) && isValidId(cid)) {
            const g = loadCanvas(pid, cid);
            if (g) broadcastGraph(pid, cid, g);
          }
        }
        broadcastProjects();
      } catch (err) {
        // The file may be mid-write (incomplete JSON); the next change will retry
        console.warn(`[watch] could not read ${key}, skipping:`, (err as Error).message);
      }
    }, 150),
  );
});

// ---------- REST ----------

function providerInfo() {
  const p = getProvider();
  return { provider: p.name, model: p.model, effort: p.effort ?? null, keyConfigured: p.configured() };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...providerInfo(), projectsDir: PROJECTS_DIR });
});

// ---------- settings (API key, provider, model, effort) ----------
// The key itself never leaves the server: clients get a masked hint and a "configured" flag.

function settingsView() {
  const cfg = resolveConfig();
  const p = getProvider();
  return {
    provider: cfg.provider,
    providers: PROVIDER_NAMES,
    model: p.model,
    effort: p.effort ?? null,
    efforts: EFFORTS,
    keyConfigured: Boolean(cfg.apiKey),
    keyMasked: maskKey(cfg.apiKey),
    keySource: cfg.keySource,
  };
}

app.get("/api/settings", (_req, res) => {
  res.json(settingsView());
});

/** The MCP bearer token (owner only), with ready-to-paste client commands. */
app.get("/api/settings/mcp", (req, res) => {
  if (!requireOwner(req, res)) return;
  const token = mcpToken();
  const origin = `${req.protocol}://${req.get("host")}`;
  res.json({
    token,
    source: mcpTokenSource(),
    url: `${origin}/mcp`,
    claudeCode: `claude mcp add --transport http quack-aloud ${origin}/mcp --header "Authorization: Bearer ${token}"`,
  });
});

app.post("/api/settings/mcp/rotate", (req, res) => {
  if (!requireOwner(req, res)) return;
  if (mcpTokenSource() === "env") {
    res.status(400).json({ error: "The token comes from MCP_TOKEN in the environment; change it there." });
    return;
  }
  res.json({ token: rotateMcpToken() });
});

app.put("/api/settings", (req, res) => {
  const body = (req.body ?? {}) as { provider?: unknown; apiKey?: unknown; model?: unknown; effort?: unknown };
  const patch: Parameters<typeof updateSettings>[0] = {};
  if (typeof body.provider === "string") {
    if (!PROVIDER_NAMES.includes(body.provider)) {
      res.status(400).json({ error: `Unknown provider "${body.provider}"` });
      return;
    }
    patch.provider = body.provider;
  }
  if (typeof body.apiKey === "string") patch.apiKey = body.apiKey;
  if (typeof body.model === "string") patch.model = body.model;
  if (typeof body.effort === "string") {
    if (!EFFORTS.includes(body.effort as Effort)) {
      res.status(400).json({ error: `Unknown effort "${body.effort}"` });
      return;
    }
    patch.effort = body.effort as Effort;
  }
  updateSettings(patch);
  res.json(settingsView());
});

/**
 * Resolve project + canvas from the query string or the body. The canvas may be omitted
 * (scripts, curl): the most recently updated canvas of the project is used then.
 */
function requireCanvas(req: Request, res: Response): { pid: string; cid: string; graph: Graph } | null {
  const body = (req.body ?? {}) as { project?: unknown; canvas?: unknown };
  const pid = (req.query.project ?? body.project) as unknown;
  if (!isValidId(pid) || !projectExists(pid)) {
    res.status(404).json({ error: `No project "${String(pid)}"` });
    return null;
  }
  const rawCid = (req.query.canvas ?? body.canvas) as unknown;
  const cid = isValidId(rawCid) ? rawCid : defaultCanvas(pid);
  const graph = cid ? loadCanvas(pid, cid) : null;
  if (!cid || !graph) {
    res.status(404).json({ error: `No canvas "${String(rawCid ?? "")}" in project "${pid}"` });
    return null;
  }
  return { pid, cid, graph };
}

app.get("/api/projects", (_req, res) => {
  res.json(listProjects());
});

app.post("/api/projects", (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const created = createProject(name);
  broadcastProjects();
  res.status(201).json(created);
});

app.patch("/api/projects/:pid", (req, res) => {
  const { pid } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!isValidId(pid) || !renameProject(pid, name)) {
    res.status(404).json({ error: `No project "${pid}"` });
    return;
  }
  broadcastProjects();
  res.json({ ok: true });
});

app.delete("/api/projects/:pid", (req, res) => {
  const { pid } = req.params;
  const result = isValidId(pid) ? deleteProject(pid) : { deleted: false };
  if (!result.deleted) {
    res.status(404).json({ error: `No project "${pid}"` });
    return;
  }
  broadcastProjects();
  res.json({ ok: true, replacement: result.replacement ?? null });
});

app.post("/api/projects/:pid/canvases", (req, res) => {
  const { pid } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const created = isValidId(pid) ? createCanvas(pid, name) : null;
  if (!created) {
    res.status(404).json({ error: `No project "${pid}"` });
    return;
  }
  broadcastProjects();
  res.status(201).json(created);
});

app.patch("/api/projects/:pid/canvases/:cid", (req, res) => {
  const { pid, cid } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  const graph = isValidId(pid) && isValidId(cid) ? renameCanvas(pid, cid, name) : null;
  if (!graph) {
    res.status(404).json({ error: `No canvas "${cid}" in project "${pid}"` });
    return;
  }
  res.json({ id: cid, graph });
});

app.delete("/api/projects/:pid/canvases/:cid", (req, res) => {
  const { pid, cid } = req.params;
  const result = isValidId(pid) && isValidId(cid) ? deleteCanvas(pid, cid) : { deleted: false };
  if (!result.deleted) {
    res.status(404).json({ error: `No canvas "${cid}" in project "${pid}"` });
    return;
  }
  broadcastProjects();
  res.json({ ok: true, replacement: result.replacement ?? null });
});

app.get("/api/graph", (req, res) => {
  const c = requireCanvas(req, res);
  if (c) res.json(c.graph);
});

/**
 * Body: { project, canvas, graph, baseSig } where baseSig is the signature of the last version
 * the client received. If the file has moved on since (another tab, Claude Code, an editor),
 * the write is refused with 409 and the current graph, so a stale tab can never clobber it.
 * A missing baseSig is accepted for scripts and curl.
 */
app.put("/api/graph", (req, res) => {
  const c = requireCanvas(req, res);
  if (!c) return;
  const body = req.body as { graph?: Graph; baseSig?: string };
  if (!body.graph) {
    res.status(400).json({ error: "Missing graph" });
    return;
  }
  if (body.baseSig && graphSignature(c.graph) !== body.baseSig) {
    res.status(409).json({ error: "The canvas changed elsewhere; reloaded it.", graph: c.graph });
    return;
  }
  res.json(saveCanvas(c.pid, c.cid, { ...body.graph, name: body.graph.name ?? c.graph.name }));
});

app.post("/api/graph/reset", (req, res) => {
  const c = requireCanvas(req, res);
  if (c) res.json(saveCanvas(c.pid, c.cid, { ...emptyGraph(), name: c.graph.name }));
});

/** Import an exported file as a new canvas in the given project. Unknown fields are dropped, bad entries skipped. */
app.post("/api/graph/import", (req, res) => {
  const body = req.body as { project?: unknown; name?: unknown; graph?: unknown } | undefined;
  const pid = body?.project;
  if (!isValidId(pid) || !projectExists(pid)) {
    res.status(404).json({ error: `No project "${String(pid)}"` });
    return;
  }
  const raw = body?.graph;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Partial<Graph>).nodes)) {
    res.status(400).json({ error: "Not a Quack Aloud export: expected a JSON object with a nodes array." });
    return;
  }
  const graph = normalize(raw);
  const name = (typeof body?.name === "string" && body.name) || graph.name || "Imported canvas";
  const created = createCanvas(pid, name, graph)!;
  broadcastProjects();
  res.status(201).json(created);
});

app.post("/api/think", async (req, res) => {
  const c = requireCanvas(req, res);
  if (!c) return;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const guide = req.body?.guide === true;
  if (!message) {
    res.status(400).json({ error: "message must not be empty" });
    return;
  }
  const provider = getProvider();
  if (!provider.configured()) {
    res.status(401).json({ error: `No API key for provider "${provider.name}". Add one in Settings (top right) or in .env.` });
    return;
  }
  try {
    const result = await provider.think(buildThinkInput(c.graph, message, guide));
    const next = saveCanvas(c.pid, c.cid, applyThinkResult(c.graph, message, result, { guide }));
    res.json({ reply: result.reply, graph: next });
  } catch (err) {
    console.error("[think]", err);
    if (err instanceof RefusalError) {
      res.status(422).json({ error: `The model declined to answer: ${err.message}` });
      return;
    }
    const described = describeProviderError(err);
    if (described) {
      res.status(described.status).json({ error: described.message });
    } else {
      res.status(500).json({ error: (err as Error).message });
    }
  }
});

// ---------- MCP over HTTP: the same duck tools as server/mcp.ts, as a service ----------

mountMcp(app);

// ---------- Production: serve the vite build from dist/ ----------

const DIST = path.resolve(process.cwd(), "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(DIST, "index.html"));
  });
}


return app;
}
