import "dotenv/config";
import express, { type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { emptyGraph, graphSignature, type Graph } from "../shared/graph";
import { DATA_DIR, GRAPH_PATH, applyThinkResult, loadGraph, normalize, saveGraph } from "./graph";
import { buildThinkInput } from "./prompt";
import { RefusalError, describeProviderError, getProvider } from "./providers";

const PORT = Number(process.env.API_PORT ?? 8787);
const app = express();
app.use(express.json({ limit: "4mb" }));

// ---------- SSE: push every change of graph.json to all browsers ----------

const sseClients = new Set<Response>();

function broadcast(graph: Graph) {
  const payload = `data: ${JSON.stringify(graph)}\n\n`;
  for (const res of sseClients) res.write(payload);
}

app.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  sseClients.add(res);
  res.write(`data: ${JSON.stringify(loadGraph())}\n\n`);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// Watch data/: whoever edits graph.json (server, Claude Code, an editor), broadcast it
fs.mkdirSync(DATA_DIR, { recursive: true });
let watchTimer: NodeJS.Timeout | undefined;
fs.watch(DATA_DIR, (_event, filename) => {
  if (filename !== path.basename(GRAPH_PATH)) return;
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    try {
      broadcast(loadGraph());
    } catch (err) {
      // The file may be mid-write (incomplete JSON); the next change will retry
      console.warn("[watch] could not read graph.json, skipping:", (err as Error).message);
    }
  }, 150);
});

// ---------- REST ----------

function providerInfo() {
  const p = getProvider();
  return { provider: p.name, model: p.model, effort: p.effort ?? null, keyConfigured: p.configured() };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...providerInfo(), graphPath: GRAPH_PATH });
});

app.get("/api/graph", (_req, res) => {
  res.json(loadGraph());
});

/**
 * Body: { graph, baseSig } where baseSig is the signature of the last version the client
 * received. If the file has moved on since (another tab, Claude Code, an editor), the
 * write is refused with 409 and the current graph, so a stale tab can never clobber it.
 * A bare graph body (no baseSig) is accepted for scripts and curl.
 */
app.put("/api/graph", (req, res) => {
  const body = req.body as { graph?: Graph; baseSig?: string } | Graph;
  const graph = "graph" in body && body.graph ? body.graph : (body as Graph);
  const baseSig = "baseSig" in body ? body.baseSig : undefined;
  if (baseSig) {
    const current = loadGraph();
    if (graphSignature(current) !== baseSig) {
      res.status(409).json({ error: "The canvas changed elsewhere; reloaded it.", graph: current });
      return;
    }
  }
  res.json(saveGraph(graph));
});

app.post("/api/graph/reset", (_req, res) => {
  res.json(saveGraph(emptyGraph()));
});

/** Replace the whole canvas with an exported file. Unknown fields are dropped, bad entries skipped. */
app.post("/api/graph/import", (req, res) => {
  const body = req.body as Partial<Graph> | undefined;
  if (!body || typeof body !== "object" || !Array.isArray(body.nodes)) {
    res.status(400).json({ error: "Not a Rubber Duck export: expected a JSON object with a nodes array." });
    return;
  }
  const saved = saveGraph(normalize(body));
  res.json(saved);
});

app.post("/api/think", async (req, res) => {
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
  const graph = loadGraph();
  try {
    const result = await provider.think(buildThinkInput(graph, message, guide));
    const next = saveGraph(applyThinkResult(graph, message, result, { guide }));
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
  console.log(`[server] graph file: ${GRAPH_PATH}`);
  if (!info.keyConfigured) {
    console.warn(`[server] no credentials for provider "${info.provider}"; chat is disabled (canvas and the Claude Code route still work)`);
  }
});
