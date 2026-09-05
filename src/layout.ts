import dagre from "@dagrejs/dagre";
import { GAP_X, GAP_Y, GROUP_PAD, NODE_H, NODE_W, type Graph, type LayoutKind, type ThoughtNode } from "../shared/graph";

export interface Size {
  w: number;
  h: number;
}
export type Sizes = Map<string, Size>;
type Pos = { x: number; y: number };

export function effectiveLayout(g: Graph): LayoutKind {
  return g.layout ?? g.suggestedLayout ?? "themes";
}

/** Re-position every card according to `kind`. Real card sizes keep long cards from overlapping. */
export function applyLayout(graph: Graph, kind: LayoutKind, sizes: Sizes = new Map()): Graph {
  const size = (id: string): Size => sizes.get(id) ?? { w: NODE_W, h: NODE_H };
  const pos =
    kind === "layered"
      ? layered(graph, size)
      : kind === "timeline"
        ? timeline(graph, size)
        : kind === "mindmap"
          ? mindmap(graph, size)
          : themes(graph, size);
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const p = pos.get(n.id);
      return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
    }),
  };
}

// ---------- themes: one column per group ----------

/**
 * Order groups so that the most connected pairs sit next to each other: brute force for
 * up to 7 groups (5040 orders), greedy nearest-neighbour beyond that.
 */
export function orderGroups(graph: Graph): string[] {
  const ids = graph.groups.map((g) => g.id).filter((id) => graph.nodes.some((n) => n.group === id));
  if (ids.length <= 2) return ids;
  const groupOf = new Map(graph.nodes.map((n) => [n.id, n.group]));
  const weight = new Map<string, number>();
  for (const e of graph.edges) {
    const a = groupOf.get(e.source), b = groupOf.get(e.target);
    if (!a || !b || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    weight.set(key, (weight.get(key) ?? 0) + 1);
  }
  const w = (a: string, b: string) => weight.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;
  const cost = (order: string[]) => {
    let c = 0;
    for (let i = 0; i < order.length; i++)
      for (let j = i + 1; j < order.length; j++) c += w(order[i], order[j]) * (j - i - 1);
    return c;
  };
  if (ids.length <= 7) {
    let best = ids, bestCost = cost(ids);
    const permute = (arr: string[], k: number) => {
      if (k === arr.length) {
        const c = cost(arr);
        if (c < bestCost) { bestCost = c; best = [...arr]; }
        return;
      }
      for (let i = k; i < arr.length; i++) {
        [arr[k], arr[i]] = [arr[i], arr[k]];
        permute(arr, k + 1);
        [arr[k], arr[i]] = [arr[i], arr[k]];
      }
    };
    permute([...ids], 0);
    return best;
  }
  const remaining = new Set(ids);
  const degree = (id: string) => ids.reduce((s, o) => s + w(id, o), 0);
  const order = [ids.reduce((a, b) => (degree(b) > degree(a) ? b : a))];
  remaining.delete(order[0]);
  while (remaining.size) {
    const last = order[order.length - 1];
    const next = [...remaining].reduce((a, b) => (w(last, b) > w(last, a) ? b : a));
    order.push(next);
    remaining.delete(next);
  }
  return order;
}

function themes(graph: Graph, size: (id: string) => Size): Map<string, Pos> {
  const columns: string[][] = [];
  for (const gid of orderGroups(graph)) {
    columns.push(graph.nodes.filter((n) => n.group === gid).map((n) => n.id));
  }
  const loose = graph.nodes.filter((n) => !n.group || !graph.groups.some((g) => g.id === n.group)).map((n) => n.id);
  if (loose.length) columns.push(loose);

  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const pos = new Map<string, Pos>();
  let x = 0;
  for (const ids of columns) {
    ids.sort((a, b) => byId.get(a)!.createdAt - byId.get(b)!.createdAt);
    let y = 0;
    for (const id of ids) {
      pos.set(id, { x, y });
      y += size(id).h + GAP_Y;
    }
    x += NODE_W + GROUP_PAD * 2 + GAP_X * 2.5; // wide gutters give cross-column edges and labels room
  }
  return pos;
}

// ---------- layered: dagre, ranked by edge direction ----------

export interface LayeredResult {
  pos: Map<string, Pos>;
  /** Way-points per edge id, from the source border to the target border, routed around intermediate cards */
  routes: Map<string, Pos[]>;
}

export function layeredLayout(graph: Graph, size: (id: string) => Size): LayeredResult {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", ranksep: 120, nodesep: 40, edgesep: 24, marginx: 0, marginy: 0 });
  for (const n of graph.nodes) g.setNode(n.id, { width: size(n.id).w, height: size(n.id).h });
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);
  const pos = new Map<string, Pos>();
  for (const n of graph.nodes) {
    const p = g.node(n.id);
    pos.set(n.id, { x: p.x - size(n.id).w / 2, y: p.y - size(n.id).h / 2 });
  }
  const routes = new Map<string, Pos[]>();
  for (const e of graph.edges) {
    const pts = g.edge(e.source, e.target)?.points as Pos[] | undefined;
    if (pts && pts.length > 2) routes.set(e.id, pts);
  }
  return { pos, routes };
}

function layered(graph: Graph, size: (id: string) => Size): Map<string, Pos> {
  return layeredLayout(graph, size).pos;
}

// ---------- timeline: events along a middle axis, entities above, claims below ----------

function neighbours(graph: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>(graph.nodes.map((n) => [n.id, new Set<string>()]));
  for (const e of graph.edges) {
    adj.get(e.source)?.add(e.target);
    adj.get(e.target)?.add(e.source);
  }
  return adj;
}

/** The cards that sit on the time axis, in order: by seq, else events by creation, else everything. */
export function timelineSpine(graph: Graph): ThoughtNode[] {
  const byTime = (a: ThoughtNode, b: ThoughtNode) => a.createdAt - b.createdAt;
  let spine = graph.nodes
    .filter((n) => n.seq !== undefined)
    .sort((a, b) => a.seq! - b.seq! || byTime(a, b));
  if (spine.length === 0) spine = graph.nodes.filter((n) => n.kind === "event").sort(byTime);
  if (spine.length === 0) spine = [...graph.nodes].sort(byTime);
  return spine;
}

/** Which swim lane an off-axis card belongs to: -1 above the axis, 1 and 2 below. */
export function timelineLane(n: ThoughtNode): -1 | 1 | 2 {
  return n.kind === "entity" ? -1 : n.kind === "claim" || n.kind === "idea" ? 1 : 2;
}

export const TIMELINE_LANE_LABEL: Record<"-1" | "0" | "1" | "2", string> = {
  "-1": "People & things",
  "0": "Events",
  "1": "Claims & beliefs",
  "2": "Duck's notes",
};

function timeline(graph: Graph, size: (id: string) => Size): Map<string, Pos> {
  const byTime = (a: ThoughtNode, b: ThoughtNode) => a.createdAt - b.createdAt;
  const spine = timelineSpine(graph);
  const spineIds = new Set(spine.map((n) => n.id));

  const pos = new Map<string, Pos>();
  const spineH = Math.max(...spine.map((n) => size(n.id).h));
  let x = 0;
  for (const n of spine) {
    pos.set(n.id, { x, y: (spineH - size(n.id).h) / 2 });
    x += size(n.id).w + GAP_X;
  }

  // Lanes: entities above the axis; claims below; the duck's cards further below.
  const lane = timelineLane;
  const rest = graph.nodes.filter((n) => !spineIds.has(n.id));
  const adj = neighbours(graph);
  const anchor = new Map<string, number | undefined>();
  for (const n of rest) {
    const xs = [...(adj.get(n.id) ?? [])]
      .filter((id) => pos.has(id))
      .map((id) => pos.get(id)!.x + size(id).w / 2);
    anchor.set(n.id, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
  }
  const laneGap = 110;
  for (const laneNo of [-1, 1, 2]) {
    const members = rest.filter((n) => lane(n) === laneNo);
    if (!members.length) continue;
    const laneH = Math.max(...members.map((n) => size(n.id).h));
    const y = laneNo < 0 ? -(laneGap + laneH) : spineH + laneGap + (laneNo - 1) * (laneH + laneGap);
    // Pack left-to-right, each card as close to its anchor as the previous card allows
    members.sort((a, b) => {
      const ax = anchor.get(a.id), bx = anchor.get(b.id);
      if (ax === undefined && bx === undefined) return byTime(a, b);
      if (ax === undefined) return 1;
      if (bx === undefined) return -1;
      return ax - bx;
    });
    let cursor = 0;
    for (const n of members) {
      const w = size(n.id).w;
      const want = anchor.get(n.id);
      const nx = Math.max(want === undefined ? cursor : want - w / 2, cursor);
      pos.set(n.id, { x: nx, y: y + (laneH - size(n.id).h) / 2 });
      cursor = nx + w + 24;
    }
  }
  return pos;
}

// ---------- mind map: balanced tree left and right of a root ----------

interface MindTree {
  rootId: string;
  children: Map<string, string[]>;
}

/** Root (pinned or the best-connected card) and the BFS tree that hangs off it. */
export function mindmapTree(graph: Graph): MindTree | null {
  if (graph.nodes.length === 0) return null;
  const adj = neighbours(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const degree = (id: string) => adj.get(id)?.size ?? 0;
  const pick = (ids: string[]) =>
    [...ids].sort((a, b) => degree(b) - degree(a) || byId.get(a)!.createdAt - byId.get(b)!.createdAt)[0];

  const rootId = graph.root && byId.has(graph.root) ? graph.root : pick(graph.nodes.map((n) => n.id));
  const children = new Map<string, string[]>(graph.nodes.map((n) => [n.id, []]));
  const seen = new Set<string>([rootId]);
  const bfs = (start: string) => {
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      const next = [...(adj.get(cur) ?? [])]
        .filter((id) => !seen.has(id))
        .sort((a, b) => byId.get(a)!.createdAt - byId.get(b)!.createdAt);
      for (const id of next) {
        seen.add(id);
        children.get(cur)!.push(id);
        queue.push(id);
      }
    }
  };
  bfs(rootId);
  while (seen.size < graph.nodes.length) {
    const orphan = pick(graph.nodes.filter((n) => !seen.has(n.id)).map((n) => n.id));
    seen.add(orphan);
    children.get(rootId)!.push(orphan);
    bfs(orphan);
  }
  return { rootId, children };
}

/** Edge ids that are parent-child links of the mind-map tree (either direction). */
export function mindmapTreeEdgeIds(graph: Graph): Set<string> {
  const tree = mindmapTree(graph);
  const ids = new Set<string>();
  if (!tree) return ids;
  const pairs = new Set<string>();
  for (const [parent, kids] of tree.children) for (const k of kids) pairs.add(`${parent}|${k}`);
  for (const e of graph.edges) {
    if (pairs.has(`${e.source}|${e.target}`) || pairs.has(`${e.target}|${e.source}`)) ids.add(e.id);
  }
  return ids;
}

function mindmap(graph: Graph, size: (id: string) => Size): Map<string, Pos> {
  const pos = new Map<string, Pos>();
  const tree = mindmapTree(graph);
  if (!tree) return pos;
  const { rootId, children } = tree;

  const subtreeH = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id)!;
    const own = size(id).h;
    const h = kids.length ? Math.max(own, kids.reduce((s, k) => s + measure(k), 0) + GAP_Y * (kids.length - 1)) : own;
    subtreeH.set(id, h);
    return h;
  };
  measure(rootId);

  // Split the root's branches into two balanced sides
  const branches = [...children.get(rootId)!].sort((a, b) => subtreeH.get(b)! - subtreeH.get(a)!);
  const sides: { sign: 1 | -1; ids: string[]; h: number }[] = [
    { sign: 1, ids: [], h: 0 },
    { sign: -1, ids: [], h: 0 },
  ];
  for (const b of branches) {
    const side = sides[0].h <= sides[1].h ? sides[0] : sides[1];
    side.ids.push(b);
    side.h += subtreeH.get(b)! + GAP_Y;
  }

  const step = NODE_W + 110;
  const rootSize = size(rootId);
  pos.set(rootId, { x: -rootSize.w / 2, y: -rootSize.h / 2 });
  const place = (id: string, depth: number, sign: 1 | -1, top: number) => {
    const s = size(id);
    const cx = sign * depth * step;
    pos.set(id, { x: cx - s.w / 2, y: top + (subtreeH.get(id)! - s.h) / 2 });
    let y = top;
    for (const k of children.get(id)!) {
      place(k, depth + 1, sign, y);
      y += subtreeH.get(k)! + GAP_Y;
    }
  };
  for (const side of sides) {
    const total = side.h - GAP_Y;
    let y = -total / 2;
    for (const id of side.ids) {
      place(id, 1, side.sign, y);
      y += subtreeH.get(id)! + GAP_Y;
    }
  }
  return pos;
}
