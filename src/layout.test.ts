import { describe, expect, it } from "vitest";
import { emptyGraph, NODE_H, NODE_W, type Graph, type ThoughtEdge, type ThoughtNode } from "../shared/graph";
import {
  applyLayout,
  effectiveLayout,
  layeredLayout,
  mindmapTree,
  mindmapTreeEdgeIds,
  orderGroups,
  timelineLane,
  timelineSpine,
  type Sizes,
} from "./layout";

function node(id: string, extra: Partial<ThoughtNode> = {}): ThoughtNode {
  return { id, label: id, origin: "user", kind: "entity", x: 0, y: 0, createdAt: 1, ...extra };
}
function edge(source: string, target: string, extra: Partial<ThoughtEdge> = {}): ThoughtEdge {
  return { id: `e-${source}-${target}`, source, target, origin: "ai", ...extra };
}

/** A small story: two people, three events in order, one claim. */
function story(): Graph {
  return {
    ...emptyGraph(),
    groups: [
      { id: "people", title: "People" },
      { id: "events", title: "Events" },
      { id: "beliefs", title: "Beliefs" },
    ],
    nodes: [
      node("alice", { group: "people", createdAt: 1 }),
      node("bob", { group: "people", createdAt: 2 }),
      node("saw", { kind: "event", group: "events", seq: 2, createdAt: 3 }),
      node("checked", { kind: "event", group: "events", seq: 3, createdAt: 4 }),
      node("arrived", { kind: "event", group: "events", seq: 1, createdAt: 5 }),
      node("lying", { kind: "claim", group: "beliefs", createdAt: 6 }),
      node("note", { kind: "question", origin: "ai", group: "beliefs", createdAt: 7 }),
    ],
    edges: [
      edge("alice", "saw"),
      edge("bob", "checked"),
      edge("checked", "saw"),
      edge("bob", "lying"),
      edge("lying", "alice"),
      edge("arrived", "saw"),
      edge("note", "lying"),
    ],
  };
}

function rects(g: Graph, sizes: Sizes = new Map()) {
  return g.nodes.map((n) => {
    const s = sizes.get(n.id) ?? { w: NODE_W, h: NODE_H };
    return { id: n.id, x1: n.x, y1: n.y, x2: n.x + s.w, y2: n.y + s.h };
  });
}

function overlapping(g: Graph, sizes?: Sizes): string[] {
  const rs = rects(g, sizes);
  const out: string[] = [];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) out.push(`${a.id}/${b.id}`);
    }
  return out;
}

describe("effectiveLayout", () => {
  it("prefers the pinned layout, then the suggestion, then themes", () => {
    expect(effectiveLayout(emptyGraph())).toBe("themes");
    expect(effectiveLayout({ ...emptyGraph(), suggestedLayout: "mindmap" })).toBe("mindmap");
    expect(effectiveLayout({ ...emptyGraph(), suggestedLayout: "mindmap", layout: "layered" })).toBe("layered");
  });
});

describe("every layout", () => {
  for (const kind of ["themes", "layered", "timeline", "mindmap"] as const) {
    it(`${kind}: places every card without overlaps`, () => {
      const g = applyLayout(story(), kind);
      expect(g.nodes).toHaveLength(7);
      expect(overlapping(g)).toEqual([]);
      for (const n of g.nodes) {
        expect(Number.isInteger(n.x)).toBe(true);
        expect(Number.isInteger(n.y)).toBe(true);
      }
    });
  }

  it("respects measured card sizes", () => {
    const sizes: Sizes = new Map([["alice", { w: 120, h: 300 }], ["bob", { w: 120, h: 300 }]]);
    for (const kind of ["themes", "layered", "timeline", "mindmap"] as const) {
      expect(overlapping(applyLayout(story(), kind, sizes), sizes)).toEqual([]);
    }
  });

  it("handles an empty graph", () => {
    for (const kind of ["themes", "layered", "timeline", "mindmap"] as const) {
      expect(applyLayout(emptyGraph(), kind).nodes).toEqual([]);
    }
  });
});

describe("themes", () => {
  it("puts the most connected groups next to each other", () => {
    const g = story();
    // beliefs <-> people has 2 links, people <-> events 2, events <-> beliefs 0: beliefs must not sit between the others
    const order = orderGroups(g);
    expect(order).toHaveLength(3);
    expect(order[1]).toBe("people");
  });

  it("stacks each theme in one column ordered by creation", () => {
    const g = applyLayout(story(), "themes");
    const col = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(col("alice")).toBe(col("bob"));
    expect(col("saw")).toBe(col("checked"));
    expect(col("alice")).not.toBe(col("saw"));
    const events = g.nodes.filter((n) => n.group === "events").sort((a, b) => a.y - b.y).map((n) => n.id);
    expect(events).toEqual(["saw", "checked", "arrived"]);
  });

  it("ignores groups nobody uses and keeps loose cards in a last column", () => {
    const g = story();
    g.groups.push({ id: "unused", title: "Unused" });
    g.nodes.push(node("loose", { group: undefined }));
    expect(orderGroups(g)).not.toContain("unused");
    const out = applyLayout(g, "themes");
    const loose = out.nodes.find((n) => n.id === "loose")!;
    expect(loose.x).toBeGreaterThan(Math.max(...out.nodes.filter((n) => n.id !== "loose").map((n) => n.x)));
  });
});

describe("layered", () => {
  it("ranks sources left of their targets", () => {
    const g = applyLayout(story(), "layered");
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(x("alice")).toBeLessThan(x("saw"));
    expect(x("arrived")).toBeLessThan(x("saw"));
    expect(x("bob")).toBeLessThan(x("checked"));
  });

  it("returns routes for edges that span more than one rank", () => {
    const { routes, pos } = layeredLayout(story(), () => ({ w: NODE_W, h: NODE_H }));
    expect(pos.size).toBe(7);
    for (const pts of routes.values()) expect(pts.length).toBeGreaterThan(2);
  });
});

describe("timeline", () => {
  it("orders the spine by seq, not by creation", () => {
    expect(timelineSpine(story()).map((n) => n.id)).toEqual(["arrived", "saw", "checked"]);
  });

  it("falls back to events, then to everything", () => {
    const noSeq = story();
    noSeq.nodes.forEach((n) => delete n.seq);
    expect(timelineSpine(noSeq).map((n) => n.id)).toEqual(["saw", "checked", "arrived"]);
    const noEvents = { ...emptyGraph(), nodes: [node("b", { createdAt: 2 }), node("a", { createdAt: 1 })] };
    expect(timelineSpine(noEvents).map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("puts entities above the axis, claims below, the duck's cards lower still", () => {
    const g = applyLayout(story(), "timeline");
    const y = (id: string) => g.nodes.find((n) => n.id === id)!.y;
    const axisY = y("saw");
    expect(y("arrived")).toBe(axisY);
    expect(y("checked")).toBe(axisY);
    expect(y("alice")).toBeLessThan(axisY);
    expect(y("lying")).toBeGreaterThan(axisY);
    expect(y("note")).toBeGreaterThan(y("lying"));
    expect(timelineLane(node("x", { kind: "entity" }))).toBe(-1);
    expect(timelineLane(node("x", { kind: "claim" }))).toBe(1);
    expect(timelineLane(node("x", { kind: "todo", origin: "ai" }))).toBe(2);
  });

  it("lays the spine out left to right in sequence order", () => {
    const g = applyLayout(story(), "timeline");
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.x;
    expect(x("arrived")).toBeLessThan(x("saw"));
    expect(x("saw")).toBeLessThan(x("checked"));
  });
});

describe("mindmap", () => {
  it("uses the pinned root, otherwise the best-connected card", () => {
    expect(mindmapTree(story())!.rootId).toBe("saw"); // degree 3
    expect(mindmapTree({ ...story(), root: "bob" })!.rootId).toBe("bob");
    expect(mindmapTree({ ...story(), root: "ghost" })!.rootId).toBe("saw");
    expect(mindmapTree(emptyGraph())).toBeNull();
  });

  it("reaches every card, including disconnected ones", () => {
    const g = story();
    g.nodes.push(node("island"));
    const tree = mindmapTree(g)!;
    const reached = new Set<string>([tree.rootId]);
    for (const kids of tree.children.values()) kids.forEach((k) => reached.add(k));
    expect(reached.size).toBe(g.nodes.length);
    expect(tree.children.get(tree.rootId)).toContain("island");
  });

  it("marks exactly the tree links as tree edges", () => {
    const ids = mindmapTreeEdgeIds(story());
    expect(ids.size).toBe(6); // 7 cards, one spanning tree
    expect(ids.has("e-alice-saw")).toBe(true);
  });

  it("puts the root in the centre with branches on both sides", () => {
    const g = applyLayout({ ...story(), root: "saw" }, "mindmap");
    const n = (id: string) => g.nodes.find((x) => x.id === id)!;
    expect(n("saw").x + NODE_W / 2).toBe(0);
    const sides = new Set(g.nodes.filter((x) => x.id !== "saw").map((x) => Math.sign(x.x + NODE_W / 2)));
    expect(sides).toEqual(new Set([1, -1]));
  });
});
