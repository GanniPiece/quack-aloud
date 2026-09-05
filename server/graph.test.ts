import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { emptyGraph, NODE_H, NODE_W, type Graph, type ThoughtNode } from "../shared/graph";
import type { ThinkOutput } from "./providers/types";

// Point the module at a scratch directory before it computes DATA_DIR
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rubber-duck-test-"));
process.env.DATA_DIR = tmp;
const mod = await import("./graph");
const { applyThinkResult, findFreeSpot, loadGraph, normalize, placeInGroup, saveGraph } = mod;

function node(id: string, extra: Partial<ThoughtNode> = {}): ThoughtNode {
  return { id, label: id, origin: "user", kind: "idea", x: 0, y: 0, createdAt: 1, ...extra };
}

function output(partial: Partial<ThinkOutput>): ThinkOutput {
  return { reply: "ok", layout: null, root: null, groups: [], updates: [], nodes: [], edges: [], ...partial };
}

describe("normalize", () => {
  it("fills defaults and drops broken entries", () => {
    const g = normalize({
      groups: [{ id: "g1", title: "One" }, { id: "g1", title: "dup" }, { id: "", title: "x" }, { title: "no id" }],
      nodes: [
        { id: "a", label: "A", origin: "bogus", kind: "bogus", group: "g1", x: "nope" },
        { id: "a", label: "duplicate id" },
        { id: "b", label: "" },
        { id: "c", label: "C", group: "missing-group", seq: 2.5 },
        null,
      ],
      edges: [
        { id: "e1", source: "a", target: "c", origin: "user" },
        { source: "a", target: "zzz" },
        { source: "a", target: "a" },
        { id: "e1", source: "c", target: "a" },
      ],
      messages: [{ role: "user", content: "hi", ts: 1 }, { role: "system", content: "x" }, { role: "assistant", content: 5 }],
      updatedAt: "later",
    });
    expect(g.groups).toEqual([{ id: "g1", title: "One" }]);
    expect(g.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(g.nodes[0]).toMatchObject({ origin: "ai", kind: "idea", group: "g1", x: 0, y: 0, createdAt: 0 });
    expect(g.nodes[1].group).toBeUndefined();
    expect(g.nodes[1].seq).toBeUndefined();
    expect(g.edges).toEqual([{ id: "e1", source: "a", target: "c", origin: "user", label: undefined }]);
    expect(g.messages).toEqual([{ role: "user", content: "hi", ts: 1 }]);
    expect(g.updatedAt).toBe(0);
  });

  it("keeps layout hints only when valid", () => {
    const g = normalize({ layout: "timeline", suggestedLayout: "circle", root: "a", nodes: [{ id: "a", label: "A" }] });
    expect(g.layout).toBe("timeline");
    expect(g.suggestedLayout).toBeUndefined();
    expect(g.root).toBe("a");
    expect(normalize({ root: "ghost" }).root).toBeUndefined();
  });
});

describe("save/load round trip", () => {
  beforeAll(() => fs.rmSync(path.join(tmp, "graph.json"), { force: true }));

  it("creates an empty graph when the file is missing", () => {
    expect(loadGraph().nodes).toEqual([]);
    expect(fs.existsSync(path.join(tmp, "graph.json"))).toBe(true);
  });

  it("persists what was saved and stamps updatedAt", () => {
    const before = Date.now();
    const saved = saveGraph({ ...emptyGraph(), nodes: [node("a", { detail: "d" })] });
    expect(saved.updatedAt).toBeGreaterThanOrEqual(before);
    const loaded = loadGraph();
    expect(loaded.nodes).toEqual(saved.nodes);
    expect(fs.existsSync(path.join(tmp, "graph.json.tmp"))).toBe(false);
  });
});

describe("placement", () => {
  it("stacks a card under its theme column", () => {
    const nodes = [node("a", { group: "g", x: 100, y: 0 }), node("b", { group: "g", x: 100, y: 200 }), node("c", { group: "h", x: 500, y: 0 })];
    expect(placeInGroup(nodes, "g")).toEqual({ x: 100, y: 200 + NODE_H + 28 });
  });

  it("starts a new theme to the right of everything", () => {
    const nodes = [node("a", { group: "g", x: 100, y: 40 }), node("c", { group: "h", x: 500, y: 10 })];
    const p = placeInGroup(nodes, "new");
    expect(p.x).toBeGreaterThan(500 + NODE_W);
    expect(p.y).toBe(10);
    expect(placeInGroup([], "new")).toEqual({ x: 0, y: 0 });
  });

  it("finds a free spot that does not overlap existing cards", () => {
    const nodes = [node("a", { x: 0, y: 0 }), node("b", { x: NODE_W + 60, y: 0 })];
    const p = findFreeSpot(nodes, nodes[0]);
    for (const n of nodes) {
      const overlaps = Math.abs(n.x - p.x) < NODE_W + 24 && Math.abs(n.y - p.y) < NODE_H + 24;
      expect(overlaps).toBe(false);
    }
    expect(findFreeSpot([])).toEqual({ x: 0, y: 0 });
  });
});

describe("applyThinkResult", () => {
  const base = (): Graph => ({
    ...emptyGraph(),
    groups: [{ id: "people", title: "People" }],
    nodes: [node("alice", { kind: "entity", group: "people" })],
    messages: [{ role: "user", content: "earlier", ts: 1 }],
  });

  it("adds cards, groups, and edges; maps model ids to real ids", () => {
    const g = applyThinkResult(
      base(),
      "Bob saw the river",
      output({
        groups: [{ id: "places", title: "Places" }, { id: "people", title: "People again" }],
        nodes: [
          { id: "bob", label: "Bob", detail: null, source: "Bob", origin: "user", kind: "entity", group: "people", seq: null, anchor_id: null },
          { id: "river", label: "the river", detail: null, source: null, origin: "user", kind: "entity", group: "places", seq: null, anchor_id: null },
          { id: "saw-river", label: "saw the river", detail: "once", source: null, origin: "user", kind: "event", group: "places", seq: 1, anchor_id: "bob" },
        ],
        edges: [
          { source: "bob", target: "saw-river", label: "did", origin: "user" },
          { source: "saw-river", target: "river", label: "in", origin: "ai" },
          { source: "bob", target: "ghost", label: "x", origin: "ai" },
          { source: "bob", target: "bob", label: "self", origin: "ai" },
        ],
        layout: "timeline",
        root: "bob",
      }),
      { guide: true },
    );
    expect(g.groups.map((x) => x.id)).toEqual(["people", "places"]);
    expect(g.nodes.map((n) => n.id)).toEqual(["alice", "bob", "river", "saw-river"]);
    expect(g.nodes.find((n) => n.id === "saw-river")).toMatchObject({ seq: 1, detail: "once", group: "places" });
    expect(g.edges.map((e) => `${e.source}>${e.target}`)).toEqual(["bob>saw-river", "saw-river>river"]);
    expect(g.suggestedLayout).toBe("timeline");
    expect(g.root).toBe("bob");
    expect(g.messages.slice(-2).map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(g.messages.at(-1)!.content).toBe("ok");
  });

  it("avoids id collisions and reuses a group by title", () => {
    const g = applyThinkResult(
      base(),
      "x",
      output({
        groups: [{ id: "folks", title: "people" }],
        nodes: [{ id: "alice", label: "Alice 2", detail: null, source: null, origin: "user", kind: "entity", group: "folks", seq: null, anchor_id: null }],
      }),
      { guide: false },
    );
    expect(g.groups).toHaveLength(1);
    expect(g.nodes.map((n) => n.id)).toEqual(["alice", "alice-2"]);
    expect(g.nodes[1].group).toBe("people");
  });

  it("applies updates to existing cards and re-files them on group change", () => {
    const start = base();
    start.groups.push({ id: "places", title: "Places" });
    start.nodes.push(node("river", { group: "places", x: 400, y: 0 }));
    const g = applyThinkResult(
      start,
      "x",
      output({ updates: [{ id: "alice", label: "Alice (narrator)", detail: "unreliable", group: "places", seq: 3 }, { id: "nope", label: "ignored", detail: null, group: null, seq: null }] }),
      { guide: false },
    );
    const alice = g.nodes.find((n) => n.id === "alice")!;
    expect(alice).toMatchObject({ label: "Alice (narrator)", detail: "unreliable", group: "places", seq: 3 });
    expect(alice.x).toBe(400); // moved under the Places column
    expect(alice.y).toBeGreaterThan(0);
  });

  it("organise mode drops the duck's cards and keeps a plain reply", () => {
    const g = applyThinkResult(
      base(),
      "x",
      output({
        reply: "Filed one card. What do you think?",
        nodes: [
          { id: "bob", label: "Bob", detail: null, source: null, origin: "user", kind: "entity", group: "people", seq: null, anchor_id: null },
          { id: "q", label: "Why?", detail: null, source: null, origin: "ai", kind: "question", group: "people", seq: null, anchor_id: null },
          { id: "todo", label: "check", detail: null, source: null, origin: "user", kind: "todo", group: "people", seq: null, anchor_id: null },
          { id: "doubt", label: "Really?", detail: null, source: null, origin: "ai", kind: "challenge", group: "people", seq: null, anchor_id: null },
        ],
      }),
      { guide: false },
    );
    expect(g.nodes.map((n) => n.id)).toEqual(["alice", "bob"]);
    // the model's reply asked a question, so it is replaced by a summary
    expect(g.messages.at(-1)!.content).toBe("Filed 1 card under People.");
  });

  it("organise mode keeps a one-line, question-free model reply", () => {
    const g = applyThinkResult(base(), "x", output({ reply: "Filed nothing new." }), { guide: false });
    expect(g.messages.at(-1)!.content).toBe("Filed nothing new.");
  });

  it("guide mode keeps question and challenge cards", () => {
    const g = applyThinkResult(
      base(),
      "x",
      output({
        nodes: [
          { id: "q", label: "Why?", detail: null, source: null, origin: "ai", kind: "question", group: "people", seq: null, anchor_id: "alice" },
          { id: "doubt", label: "Alice never saw it", detail: "she only heard", source: null, origin: "ai", kind: "challenge", group: "people", seq: null, anchor_id: "alice" },
        ],
        edges: [{ source: "doubt", target: "alice", label: "challenges", origin: "ai" }],
      }),
      { guide: true },
    );
    expect(g.nodes.map((n) => n.kind)).toEqual(["entity", "question", "challenge"]);
    expect(g.edges).toEqual([{ id: "e-doubt-alice", source: "doubt", target: "alice", label: "challenges", origin: "ai" }]);
  });
});
