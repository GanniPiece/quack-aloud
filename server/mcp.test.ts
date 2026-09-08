import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-mcp-"));
process.env.DATA_DIR = tmp;
const { createCanvasTool, createProjectTool, duckTurnTool, listProjectsTool, readCanvasTool } = await import("./mcpTools");

const base = { reply: "", layout: null, root: null, groups: [], updates: [], nodes: [], edges: [], remove_edges: [] };

describe("MCP tools", () => {
  it("bootstraps a first project and lists it", () => {
    const list = listProjectsTool();
    expect(list).toHaveLength(1);
    expect(list[0].canvases[0]).toMatchObject({ name: "Main", cards: 0 });
  });

  it("creates projects and canvases", () => {
    const p = createProjectTool({ name: "小說", canvasName: "概念" });
    expect(p.canvas).toMatch(/^c-/);
    const c = createCanvasTool({ project: p.project, name: "人物" });
    const names = listProjectsTool().find((x) => x.id === p.project)!.canvases.map((x) => x.name).sort();
    expect(names).toEqual(["人物", "概念"]);
    expect(c.canvas).not.toBe(p.canvas);
    expect(() => createCanvasTool({ project: "nope", name: "x" })).toThrow(/list_projects/);
  });

  it("applies a turn through the same merge logic as the chat", () => {
    const p = createProjectTool({ name: "Story" });
    const r = duckTurnTool({
      ...base,
      project: p.project,
      message: "Alice saw a dead cat in the river",
      guide: false,
      reply: "Filed 3 cards under People and Events.",
      groups: [{ id: "people", title: "People" }, { id: "events", title: "Events" }],
      nodes: [
        { id: "alice", label: "Alice", detail: null, source: "Alice", origin: "user", kind: "entity", group: "people", seq: null, anchor_id: null },
        { id: "river", label: "the river", detail: null, source: null, origin: "user", kind: "entity", group: "people", seq: null, anchor_id: null },
        { id: "saw-cat", label: "saw a dead cat", detail: null, source: null, origin: "user", kind: "event", group: "events", seq: 1, anchor_id: "alice" },
        { id: "q", label: "Really?", detail: null, source: null, origin: "ai", kind: "question", group: "events", seq: null, anchor_id: null },
      ],
      edges: [{ source: "alice", target: "saw-cat", label: "did", origin: "user" }, { source: "saw-cat", target: "river", label: "in", origin: "ai" }],
    });
    expect(r.added.map((n) => n.id)).toEqual(["alice", "river", "saw-cat"]); // the question was dropped: guide=false
    expect(r.droppedDuckCards).toBe(1);
    expect(r.reply).toBe("Filed 3 cards under People and Events.");
    expect(r.totals).toEqual({ cards: 3, edges: 2, groups: 2 });

    const view = readCanvasTool({ project: p.project, canvas: p.canvas, messages: 2 });
    expect(view.nodes.map((n) => n.id)).toEqual(["alice", "river", "saw-cat"]);
    expect(view.nodes[0]).not.toHaveProperty("x");
    expect(view.recentMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(view.recentMessages[0].content).toBe("Alice saw a dead cat in the river");

    // second turn refines an existing card and keeps a duck card because guide is on
    const r2 = duckTurnTool({
      ...base,
      project: p.project,
      canvas: p.canvas,
      message: "She saw it three times",
      guide: true,
      reply: "Three times. Did anyone else see it?",
      updates: [{ id: "saw-cat", label: null, detail: "3 times", group: null, seq: null }],
      nodes: [{ id: "who-else", label: "Did anyone else see it?", detail: null, source: null, origin: "ai", kind: "question", group: "events", seq: null, anchor_id: "saw-cat" }],
      edges: [{ source: "who-else", target: "saw-cat", label: "asks about", origin: "ai" }],
    });
    expect(r2.added.map((n) => n.kind)).toEqual(["question"]);
    const after = readCanvasTool({ project: p.project });
    expect(after.nodes.find((n) => n.id === "saw-cat")!.detail).toBe("3 times");
    expect(after.recentMessages).toHaveLength(4);
  });

  it("refuses unknown projects and canvases with a hint", () => {
    expect(() => readCanvasTool({ project: "ghost" })).toThrow(/list_projects/);
    const p = createProjectTool({ name: "X" });
    expect(() => readCanvasTool({ project: p.project, canvas: "c-nope" })).toThrow(/No canvas/);
  });
});
