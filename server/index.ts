import "dotenv/config";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { emptyGraph, graphSignature, type Graph } from "../shared/graph";
import { DATA_DIR, applyThinkResult, normalize } from "./graph";
import {
  PROJECTS_DIR,
  createProject,
  deleteProject,
  ensureMigrated,
  ensureOneProject,
  isValidId,
  listProjects,
  loadProject,
  renameProject,
  saveProject,
} from "./projects";
import { buildThinkInput } from "./prompt";
import { RefusalError, describeProviderError, getProvider } from "./providers";

const PORT = Number(process.env.API_PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "8mb" }));

fs.mkdirSync(DATA_DIR, { recursive: true });
ensureMigrated();
ensureOneProject();

// ---------- SSE: push project changes to browsers ----------
// event "graph": { project, graph } whenever a project file changes
// event "projects": the project list whenever any file is added, removed, or saved

const sseClients = new Set<Response>();

function send(res: Response, event: string, payload: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcastGraph(project: string, graph: Graph) {
  for (const res of sseClients) send(res, "graph", { project, graph });
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
  const project = req.query.project;
  if (isValidId(project)) {
    const g = loadProject(project);
    if (g) send(res, "graph", { project, graph: g });
  }
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Watch data/projects: whoever edits a file (server, Claude Code, an editor), broadcast it
const watchTimers = new Map<string, NodeJS.Timeout>();
fs.watch(PROJECTS_DIR, (_event, filename) => {
  if (!filename || !filename.endsWith(".json")) return;
  const id = filename.slice(0, -5);
  if (!isValidId(id)) return;
  clearTimeout(watchTimers.get(id));
  watchTimers.set(
    id,
    setTimeout(() => {
      watchTimers.delete(id);
      try {
        const g = loadProject(id);
        if (g) broadcastGraph(id, g);
        broadcastProjects();
      } catch (err) {
        // The file may be mid-write (incomplete JSON); the next change will retry
        console.warn(`[watch] could not read ${filename}, skipping:`, (err as Error).message);
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

/** Resolve the project id from ?project= or body.project; 400 if missing, 404 if unknown. */
function requireProject(req: Request, res: Response): { id: string; graph: Graph } | null {
  const id = (req.query.project ?? (req.body as { project?: unknown } | undefined)?.project) as unknown;
  if (!isValidId(id)) {
    res.status(400).json({ error: "Missing or invalid project id" });
    return null;
  }
  const graph = loadProject(id);
  if (!graph) {
    res.status(404).json({ error: `No project "${id}"` });
    return null;
  }
  return { id, graph };
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

app.patch("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const name = typeof req.body?.name === "string" ? req.body.name : "";
  if (!isValidId(id)) {
    res.status(400).json({ error: "Invalid project id" });
    return;
  }
  const graph = renameProject(id, name);
  if (!graph) {
    res.status(404).json({ error: `No project "${id}"` });
    return;
  }
  res.json({ id, graph });
});

app.delete("/api/projects/:id", (req, res) => {
  const { id } = req.params;
  const result = isValidId(id) ? deleteProject(id) : { deleted: false };
  if (!result.deleted) {
    res.status(404).json({ error: `No project "${id}"` });
    return;
  }
  broadcastProjects();
  res.json({ ok: true, replacement: result.replacement ?? null });
});

app.get("/api/graph", (req, res) => {
  const p = requireProject(req, res);
  if (p) res.json(p.graph);
});

/**
 * Body: { project, graph, baseSig } where baseSig is the signature of the last version the
 * client received. If the file has moved on since (another tab, Claude Code, an editor), the
 * write is refused with 409 and the current graph, so a stale tab can never clobber it.
 * A missing baseSig is accepted for scripts and curl.
 */
app.put("/api/graph", (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  const body = req.body as { graph?: Graph; baseSig?: string };
  if (!body.graph) {
    res.status(400).json({ error: "Missing graph" });
    return;
  }
  if (body.baseSig && graphSignature(p.graph) !== body.baseSig) {
    res.status(409).json({ error: "The canvas changed elsewhere; reloaded it.", graph: p.graph });
    return;
  }
  res.json(saveProject(p.id, { ...body.graph, name: body.graph.name ?? p.graph.name }));
});

app.post("/api/graph/reset", (req, res) => {
  const p = requireProject(req, res);
  if (p) res.json(saveProject(p.id, { ...emptyGraph(), name: p.graph.name }));
});

/** Import an exported file as a new project. Unknown fields are dropped, bad entries skipped. */
app.post("/api/graph/import", (req, res) => {
  const body = req.body as { name?: unknown; graph?: unknown } | Partial<Graph> | undefined;
  const raw = body && typeof body === "object" && "graph" in body && body.graph ? body.graph : body;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as Partial<Graph>).nodes)) {
    res.status(400).json({ error: "Not a Quack Aloud export: expected a JSON object with a nodes array." });
    return;
  }
  const graph = normalize(raw);
  const name =
    (body && typeof body === "object" && "name" in body && typeof body.name === "string" && body.name) ||
    graph.name ||
    "Imported project";
  const created = createProject(name, graph);
  broadcastProjects();
  res.status(201).json(created);
});

app.post("/api/think", async (req, res) => {
  const p = requireProject(req, res);
  if (!p) return;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const guide = req.body?.guide === true;
  if (!message) {
    res.status(400).json({ error: "message must not be empty" });
    return;
  }
  const provider = getProvider();
  if (!provider.configured()) {
    res.status(401).json({ error: `No credentials for provider "${provider.name}". See README to set up .env.` });
    return;
  }
  try {
    const result = await provider.think(buildThinkInput(p.graph, message, guide));
    const next = saveProject(p.id, applyThinkResult(p.graph, message, result, { guide }));
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
