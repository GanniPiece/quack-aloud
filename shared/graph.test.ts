import { describe, expect, it } from "vitest";
import { emptyGraph, graphSignature, type Graph } from "./graph";

function sample(): Graph {
  return {
    ...emptyGraph(),
    groups: [{ id: "g", title: "G" }],
    nodes: [{ id: "a", label: "A", origin: "user", kind: "idea", group: "g", x: 1, y: 2, createdAt: 3 }],
    edges: [{ id: "e", source: "a", target: "a", origin: "ai" }],
    messages: [{ role: "user", content: "hi", ts: 1 }],
    updatedAt: 100,
  };
}

describe("graphSignature", () => {
  it("ignores updatedAt", () => {
    const a = sample();
    const b = { ...sample(), updatedAt: 999 };
    expect(graphSignature(a)).toBe(graphSignature(b));
  });

  it("ignores key order and undefined fields", () => {
    const a = sample();
    const b = sample();
    b.nodes = [{ y: 2, x: 1, createdAt: 3, kind: "idea", origin: "user", label: "A", id: "a", group: "g", detail: undefined }];
    expect(graphSignature(a)).toBe(graphSignature(b));
  });

  it("changes when content changes", () => {
    const a = sample();
    const b = sample();
    b.nodes[0].x = 50;
    expect(graphSignature(a)).not.toBe(graphSignature(b));
    const c = sample();
    c.layout = "timeline";
    expect(graphSignature(a)).not.toBe(graphSignature(c));
  });
});

describe("emptyGraph", () => {
  it("has no content and version 1", () => {
    const g = emptyGraph();
    expect(g.version).toBe(1);
    expect(g.nodes).toEqual([]);
    expect(g.edges).toEqual([]);
    expect(g.groups).toEqual([]);
    expect(g.messages).toEqual([]);
  });
});
