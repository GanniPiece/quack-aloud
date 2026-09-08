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
  clearSessionCookie,
  hasPassword,
  isAuthenticated,
  issueSession,
  loginLocked,
  passwordSource,
  recordLogin,
  requireAuth,
  setPassword,
  setSessionCookie,
  validatePassword,
  verifyPassword,
} from "./auth";
import { buildThinkInput } from "./prompt";
import { PROVIDER_NAMES, RefusalError, describeProviderError, getProvider } from "./providers";
import { EFFORTS, maskKey, resolveConfig, updateSettings, type Effort } from "./settings";

const PORT = Number(process.env.API_PORT ?? 8787);
const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
app.use(express.json({ limit: "8mb" }));

fs.mkdirSync(DATA_DIR, { recursive: true });
ensureMigrated();
ensureOneProject();

// ---------- auth ----------
// A single shared password (set on first visit, or APP_PASSWORD) and a signed session cookie.
// Every /api route below except these needs a session; static files are served regardless
// because the login screen is part of the same page.

app.get("/api/auth/status", (req, res) => {
  res.json({ authRequired: !authDisabled(), configured: hasPassword(), authenticated: isAuthenticated(req), source: passwordSource() });
});

/** First run: create the password. Refused once one exists (change it in Settings instead). */
app.post("/api/auth/setup", (req, res) => {
  if (authDisabled()) {
    res.status(400).json({ error: "Authentication is disabled (AUTH_DISABLED)." });
    return;
  }
  if (hasPassword()) {
    res.status(409).json({ error: "A password is already set. Sign in, then change it in Settings." });
    return;
  }
  const problem = validatePassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  setPassword(req.body.password);
  setSessionCookie(req, res, issueSession());
  res.status(201).json({ ok: true });
});

app.post("/api/auth/login", (req, res) => {
  const ip = req.ip ?? "unknown";
  const wait = loginLocked(ip);
  if (wait > 0) {
    res.status(429).json({ error: `Too many attempts. Try again in ${wait}s.` });
    return;
  }
  const ok = typeof req.body?.password === "string" && verifyPassword(req.body.password);
  recordLogin(ip, ok);
  if (!ok) {
    res.status(401).json({ error: "Wrong password." });
    return;
  }
  setSessionCookie(req, res, issueSession());
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(req, res);
  res.json({ ok: true });
});

/** Change the password: needs a session and the current password. Ends every other session. */
app.post("/api/auth/password", (req, res) => {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: "Sign in to continue.", authRequired: true });
    return;
  }
  if (passwordSource() === "env" && !req.body?.current) {
    // still allow: a file password will take precedence over APP_PASSWORD from now on
  } else if (!(typeof req.body?.current === "string" && verifyPassword(req.body.current))) {
    res.status(401).json({ error: "Current password is wrong." });
    return;
  }
  const problem = validatePassword(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  setPassword(req.body.password);
  setSessionCookie(req, res, issueSession());
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

// ---------- Production: serve the vite build from dist/ ----------

const DIST = path.resolve(process.cwd(), "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(DIST, "index.html"));
  });
}

app.listen(PORT, () => {
  const info = providerInfo();
  console.log(`[server] http://localhost:${PORT}  provider=${info.provider} model=${info.model} effort=${info.effort ?? "-"}`);
  console.log(`[server] projects: ${PROJECTS_DIR} (${listProjects().length})`);
  if (!info.keyConfigured) {
    console.warn(`[server] no credentials for provider "${info.provider}"; chat is disabled (canvas and the Claude Code route still work)`);
  }
});
