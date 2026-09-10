import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, it } from "vitest";

it("Codex's npm stdio command works from a nested directory and files a duck turn", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "quack-codex-stdio-"));
  const client = new Client({ name: "codex-stdio-smoke", version: "1" });
  const transport = new StdioClientTransport({
    command: "npm", args: ["run", "--silent", "mcp"], cwd: path.resolve("src"),
    env: { ...process.env as Record<string, string>, DATA_DIR: dataDir, DOTENV_CONFIG_PATH: "/dev/null", npm_config_cache: path.join(dataDir, "npm-cache") },
    stderr: "pipe",
  });
  const parse = (result: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((result.content as { text: string }[])[0].text);
  try {
    await client.connect(transport);
    expect(client.getInstructions()).toContain("Decompose, do not transcribe");
    const project = parse(await client.callTool({ name: "create_project", arguments: { name: "Codex smoke" } }));
    await client.callTool({ name: "read_canvas", arguments: { project: project.project, canvas: project.canvas } });
    const turn = parse(await client.callTool({ name: "duck_turn", arguments: {
      project: project.project, canvas: project.canvas, message: "Database", guide: false,
      reply: "Filed Database.", layout: null, root: null, groups: [], updates: [], edges: [], remove_edges: [],
      nodes: [{ id: "database", label: "Database", origin: "user", kind: "entity", detail: null, source: "Database", group: null, seq: null, anchor_id: null }],
    } }));
    expect(turn.totals.cards).toBe(1);
    const canvas = parse(await client.callTool({ name: "read_canvas", arguments: { project: project.project, canvas: project.canvas } }));
    expect(canvas.nodes[0].label).toBe("Database");
    expect(canvas.recentMessages).toHaveLength(2);
    expect(fs.existsSync(path.join(dataDir, "projects", project.project, `${project.canvas}.json`))).toBe(true);
  } finally {
    await client.close();
    await transport.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}, 15_000);
