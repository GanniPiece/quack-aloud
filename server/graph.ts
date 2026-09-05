import fs from "node:fs";
import path from "node:path";
import {
  emptyGraph,
  GAP_X,
  GAP_Y,
  NODE_H,
  NODE_W,
  type Graph,
  type Group,
  type LayoutKind,
  type NodeKind,
  type Origin,
  type ThoughtEdge,
  type ThoughtNode,
} from "../shared/graph";
import type { ThinkOutput } from "./providers/types";

/** Where graph.json lives. DATA_DIR env overrides it (tests, or a shared folder). */
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(process.cwd(), "data");
export const GRAPH_PATH = path.join(DATA_DIR, "graph.json");

const ORIGINS: Origin[] = ["user", "ai"];
const KINDS: NodeKind[] = ["entity", "event", "claim", "idea", "question", "insight", "todo"];
const LAYOUTS: LayoutKind[] = ["themes", "layered", "timeline", "mindmap"];
const asLayout = (v: unknown): LayoutKind | undefined => (LAYOUTS.includes(v as LayoutKind) ? (v as LayoutKind) : undefined);

export function loadGraph(): Graph {
  let raw: string;
  try {
    raw = fs.readFileSync(GRAPH_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const g = emptyGraph();
      saveGraph(g);
      return g;
    }
    throw err;
  }
  return normalize(JSON.parse(raw));
}

export function saveGraph(graph: Graph): Graph {
  const next: Graph = { ...normalize(graph), updatedAt: Date.now() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${GRAPH_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, GRAPH_PATH);
  return next;
}

/** Fill in missing fields and drop bad entries so a hand-edited graph.json still loads. */
export function normalize(input: unknown): Graph {
  const g = (input ?? {}) as Partial<Graph>;

  const groups: Group[] = [];
  const groupIds = new Set<string>();
  for (const gr of Array.isArray(g.groups) ? g.groups : []) {
    if (!gr || typeof gr.id !== "string" || !gr.id || groupIds.has(gr.id)) continue;
    if (typeof gr.title !== "string" || !gr.title) continue;
    groupIds.add(gr.id);
    groups.push({ id: gr.id, title: gr.title });
  }

  const nodes: ThoughtNode[] = [];
  const seen = new Set<string>();
  for (const n of Array.isArray(g.nodes) ? g.nodes : []) {
    if (!n || typeof n.id !== "string" || !n.id || seen.has(n.id)) continue;
    if (typeof n.label !== "string" || !n.label) continue;
    seen.add(n.id);
    nodes.push({
      id: n.id,
      label: n.label,
      detail: typeof n.detail === "string" && n.detail ? n.detail : undefined,
      source: typeof n.source === "string" && n.source ? n.source : undefined,
      origin: ORIGINS.includes(n.origin as Origin) ? (n.origin as Origin) : "ai",
      kind: KINDS.includes(n.kind as NodeKind) ? (n.kind as NodeKind) : "idea",
      group: typeof n.group === "string" && groupIds.has(n.group) ? n.group : undefined,
      seq: Number.isInteger(n.seq) ? (n.seq as number) : undefined,
      x: Number.isFinite(n.x) ? n.x : 0,
      y: Number.isFinite(n.y) ? n.y : 0,
      createdAt: Number.isFinite(n.createdAt) ? n.createdAt : 0,
    });
  }

  const edges: ThoughtEdge[] = [];
  const seenEdge = new Set<string>();
  for (const e of Array.isArray(g.edges) ? g.edges : []) {
    if (!e || typeof e.source !== "string" || typeof e.target !== "string") continue;
    if (!seen.has(e.source) || !seen.has(e.target) || e.source === e.target) continue;
    const id = typeof e.id === "string" && e.id ? e.id : `e-${e.source}-${e.target}`;
    if (seenEdge.has(id)) continue;
    seenEdge.add(id);
    edges.push({
      id,
      source: e.source,
      target: e.target,
      label: typeof e.label === "string" && e.label ? e.label : undefined,
      origin: ORIGINS.includes(e.origin as Origin) ? (e.origin as Origin) : "ai",
    });
  }

  const messages = (Array.isArray(g.messages) ? g.messages : []).filter(
    (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
  );

  return {
    version: 1,
    layout: asLayout(g.layout),
    suggestedLayout: asLayout(g.suggestedLayout),
    root: typeof g.root === "string" && seen.has(g.root) ? g.root : undefined,
    groups,
    nodes,
    edges,
    messages,
    updatedAt: Number.isFinite(g.updatedAt) ? (g.updatedAt as number) : 0,
  };
}

// ---------- Merge model output into the canvas ----------

export interface ApplyOptions {
  /** When false, cards of kind question/insight/todo are dropped and the reply must stay opinion-free. */
  guide: boolean;
}

export function applyThinkResult(
  graph: Graph,
  userMessage: string,
  result: ThinkOutput,
  { guide }: ApplyOptions,
): Graph {
  const now = Date.now();
  const groups = [...graph.groups];
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const edges = [...graph.edges];
  const groupIds = new Set(groups.map((g) => g.id));
  const groupIdMap = new Map<string, string>(); // model-supplied group id -> actual id
  const existing = new Set(nodes.map((n) => n.id));
  const idMap = new Map<string, string>(); // model-supplied node id -> actual id

  // 1. Groups: reuse by id or by identical title, otherwise create.
  for (const gr of result.groups) {
    const title = gr.title.trim();
    if (!title) continue;
    const byTitle = groups.find((g) => g.title.toLowerCase() === title.toLowerCase());
    if (groupIds.has(gr.id)) {
      groupIdMap.set(gr.id, gr.id);
    } else if (byTitle) {
      groupIdMap.set(gr.id, byTitle.id);
    } else {
      const id = uniqueId(slugify(gr.id) || slugify(title) || "theme", groupIds);
      groupIds.add(id);
      groups.push({ id, title });
      groupIdMap.set(gr.id, id);
    }
  }
  const resolveGroup = (id: string | null | undefined): string | undefined => {
    if (!id) return undefined;
    const actual = groupIdMap.get(id) ?? id;
    return groupIds.has(actual) ? actual : undefined;
  };

  // 2. Updates to existing cards. A group change re-files the card into that column.
  for (const u of result.updates) {
    const node = nodes.find((n) => n.id === u.id);
    if (!node) continue;
    if (u.label?.trim()) node.label = u.label.trim();
    if (u.detail !== null && u.detail !== undefined) node.detail = u.detail.trim() || undefined;
    if (u.seq !== null && u.seq !== undefined) node.seq = u.seq;
    const g = resolveGroup(u.group);
    if (g && g !== node.group) {
      node.group = g;
      const others = nodes.filter((n) => n.id !== node.id);
      const pos = placeInGroup(others, g);
      node.x = pos.x;
      node.y = pos.y;
    }
  }

  // 3. New cards. Organise-only mode keeps just the user's ideas.
  const DUCK_KINDS: NodeKind[] = ["question", "insight", "todo"];
  const wantedNodes = guide
    ? result.nodes
    : result.nodes.filter((n) => n.origin === "user" && !DUCK_KINDS.includes(n.kind));
  const added: string[] = [];
  for (const n of wantedNodes) {
    if (!n.label.trim()) continue;
    const id = uniqueId(slugify(n.id) || `n-${now.toString(36)}`, existing);
    existing.add(id);
    idMap.set(n.id, id);

    const group = resolveGroup(n.group);
    const anchorId = n.anchor_id ? (idMap.get(n.anchor_id) ?? n.anchor_id) : undefined;
    const anchor = anchorId ? nodes.find((x) => x.id === anchorId) : undefined;
    const pos = group ? placeInGroup(nodes, group) : findFreeSpot(nodes, anchor);
    nodes.push({
      id,
      label: n.label.trim(),
      detail: n.detail?.trim() || undefined,
      source: n.source?.trim() || undefined,
      origin: n.origin,
      kind: n.kind,
      group,
      seq: n.seq ?? undefined,
      x: pos.x,
      y: pos.y,
      createdAt: now,
    });
    added.push(n.label.trim());
  }

  // 4. Edges (inferred relations are allowed in both modes; they are structure, not advice).
  for (const e of result.edges) {
    const source = idMap.get(e.source) ?? e.source;
    const target = idMap.get(e.target) ?? e.target;
    if (!existing.has(source) || !existing.has(target) || source === target) continue;
    if (edges.some((x) => x.source === source && x.target === target)) continue;
    edges.push({
      id: `e-${source}-${target}`,
      source,
      target,
      label: e.label?.trim() || undefined,
      origin: e.origin,
    });
  }

  const usedGroups = groups.filter((g) => nodes.some((n) => n.group === g.id));
  const reply = guide ? result.reply : organizeReply(result.reply, added, usedGroups, nodes);
  const rootId = result.root ? (idMap.get(result.root) ?? result.root) : undefined;

  return {
    ...graph,
    suggestedLayout: result.layout ?? graph.suggestedLayout,
    root: rootId && existing.has(rootId) ? rootId : graph.root,
    groups,
    nodes,
    edges,
    messages: [
      ...graph.messages,
      { role: "user", content: userMessage, ts: now },
      { role: "assistant", content: reply, ts: now + 1 },
    ],
  };
}

/** Organise-only reply: the model's one-liner if it stayed opinion-free, otherwise a plain summary. */
function organizeReply(modelReply: string, added: string[], groups: Group[], nodes: ThoughtNode[]): string {
  const clean = modelReply.trim();
  const oneSentence = clean.length > 0 && clean.length <= 160 && !/[?？]/.test(clean) && !/\n/.test(clean);
  if (oneSentence) return clean;
  if (added.length === 0) return "Nothing new to file.";
  const titles = groups
    .filter((g) => nodes.some((n) => n.group === g.id && added.includes(n.label)))
    .map((g) => g.title);
  const where = titles.length ? ` under ${titles.join(", ")}` : "";
  return `Filed ${added.length} card${added.length === 1 ? "" : "s"}${where}.`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * Column layout by theme: a group's cards stack vertically under its first card.
 * A brand-new group starts a fresh column to the right of everything.
 */
export function placeInGroup(nodes: ThoughtNode[], groupId: string): { x: number; y: number } {
  const members = nodes.filter((n) => n.group === groupId);
  if (members.length > 0) {
    const x = Math.min(...members.map((n) => n.x));
    const y = Math.max(...members.map((n) => n.y)) + NODE_H + GAP_Y;
    return { x, y };
  }
  if (nodes.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...nodes.map((n) => n.x)) + NODE_W + GAP_X * 2;
  const top = Math.min(...nodes.map((n) => n.y));
  return { x: right, y: top };
}

/** Loose cards: find a spot near the anchor that does not overlap; without an anchor, use the newest card. */
export function findFreeSpot(
  nodes: ThoughtNode[],
  anchor?: ThoughtNode,
): { x: number; y: number } {
  if (!anchor) {
    if (nodes.length === 0) return { x: 0, y: 0 };
    anchor = nodes[nodes.length - 1];
  }
  const gapX = NODE_W + 24;
  const gapY = NODE_H + 24;
  const overlaps = (x: number, y: number) =>
    nodes.some((n) => Math.abs(n.x - x) < gapX && Math.abs(n.y - y) < gapY);

  for (let ring = 1; ring <= 8; ring++) {
    const rx = ring * (NODE_W + 60);
    const ry = ring * (NODE_H + 70);
    const steps = 8 * ring;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = Math.round(anchor.x + Math.cos(a) * rx);
      const y = Math.round(anchor.y + Math.sin(a) * ry);
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: anchor.x + gapX * 2, y: anchor.y + nodes.length * 30 };
}
