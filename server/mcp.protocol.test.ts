import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Talks to the real McpServer over the SDK's in-memory transport: the same handshake,
// tool listing, schema validation, and tool calls a Claude Code session would perform.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-mcp-proto-"));
process.env.DATA_DIR = tmp;
const { createMcpServer } = await import("./mcp");

const client = new Client({ name: "test-client", version: "0" });
const server = createMcpServer();

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  await client.connect(clientSide);
});
afterAll(async () => {
  await client.close();
  await server.close();
});

const parse = (r: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((r.content as { text: string }[])[0].text);

describe("MCP protocol", () => {
  it("announces the duck's instructions and five tools", async () => {
    expect(client.getInstructions()).toContain("Decompose, do not transcribe");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_canvas", "create_project", "duck_turn", "list_projects", "read_canvas"]);
    const duck = tools.find((t) => t.name === "duck_turn")!;
    expect(Object.keys(duck.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["project", "canvas", "message", "guide", "reply", "groups", "updates", "nodes", "edges", "remove_edges", "layout", "root"]),
    );
  });

  it("rejects a call that does not match the schema", async () => {
    const r = await client.callTool({ name: "duck_turn", arguments: { project: "x" } }); // missing message and the decomposition
    expect(r.isError).toBe(true);
  });

  it("files a turn end to end and reads it back", async () => {
    const created = parse(await client.callTool({ name: "create_project", arguments: { name: "小說", canvasName: "概念" } }));
    expect(created.canvas).toMatch(/^c-/);

    const turn = parse(
      await client.callTool({
        name: "duck_turn",
        arguments: {
          project: created.project,
          message: "河道裡死了一隻黑貓",
          guide: false,
          reply: "已歸入「事件」。",
          layout: "timeline",
          root: null,
          groups: [{ id: "events", title: "事件" }],
          updates: [],
          nodes: [
            { id: "black-cat", label: "黑貓", detail: null, source: "黑貓", origin: "user", kind: "entity", group: "events", seq: null, anchor_id: null },
            { id: "cat-died", label: "死在河道", detail: null, source: "河道裡死了一隻黑貓", origin: "user", kind: "event", group: "events", seq: 1, anchor_id: "black-cat" },
            { id: "why", label: "為什麼是黑貓？", detail: null, source: null, origin: "ai", kind: "question", group: "events", seq: null, anchor_id: null },
          ],
          edges: [{ source: "black-cat", target: "cat-died", label: "發生", origin: "user" }],
          remove_edges: [],
        },
      }),
    );
    expect(turn.added.map((n: { id: string }) => n.id)).toEqual(["black-cat", "cat-died"]); // guide=false drops the question
    expect(turn.droppedDuckCards).toBe(1);

    const view = parse(await client.callTool({ name: "read_canvas", arguments: { project: created.project } }));
    expect(view.name).toBe("概念");
    expect(view.layout).toBe("timeline");
    expect(view.nodes.map((n: { label: string }) => n.label)).toEqual(["黑貓", "死在河道"]);
    expect(view.recentMessages.map((m: { role: string }) => m.role)).toEqual(["user", "assistant"]);

    const list = parse(await client.callTool({ name: "list_projects", arguments: {} }));
    expect(list[0]).toMatchObject({ id: created.project, name: "小說" });
    expect(list[0].canvases[0]).toMatchObject({ name: "概念", cards: 2 });
  });

  it("returns a readable error for an unknown project", async () => {
    const r = await client.callTool({ name: "read_canvas", arguments: { project: "ghost" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/list_projects/);
  });
});
