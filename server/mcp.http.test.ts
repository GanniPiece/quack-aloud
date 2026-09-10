import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { McpInfo } from "../src/api";

// The MCP server as a service: mounted on the same Express app as the API, protected by a
// bearer token, so it starts with Docker and remote agents can connect over HTTP.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quack-aloud-mcp-http-"));
process.env.DATA_DIR = tmp;
process.env.DOTENV_CONFIG_PATH = "/dev/null";
delete process.env.MCP_TOKEN;
for (const name of ["AUTH_DISABLED", "APP_EMAIL", "APP_PASSWORD"]) delete process.env[name];
const { createApp } = await import("./app");
const { mcpToken, rotateMcpToken } = await import("./mcpHttp");

let http: Server;
let base = "";

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    http = app.listen(0, "127.0.0.1", () => resolve());
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

async function connect(token: string | null) {
  const client = new Client({ name: "http-test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close();
    throw error;
  }
  return client;
}

describe("MCP over HTTP", () => {
  it("has a token from the start, stored owner-only, and can rotate it", () => {
    const t1 = mcpToken();
    expect(t1).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(mcpToken()).toBe(t1);
    expect(fs.statSync(path.join(tmp, "auth.json")).mode & 0o777).toBe(0o600);
    const t2 = rotateMcpToken();
    expect(t2).not.toBe(t1);
    expect(mcpToken()).toBe(t2);
  });

  it("refuses requests without the right token", async () => {
    const res = await fetch(`${base}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" });
    expect(res.status).toBe(401);
    await expect(connect("not-the-token")).rejects.toThrow();
  });

  it("serves the duck's tools to a client that presents the token", async () => {
    const client = await connect(mcpToken());
    expect(client.getInstructions()).toContain("Decompose, do not transcribe");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["create_canvas", "create_project", "duck_turn", "list_projects", "read_canvas"]);
    const r = await client.callTool({ name: "list_projects", arguments: {} });
    const list = JSON.parse((r.content as { text: string }[])[0].text);
    expect(list[0].canvases[0]).toMatchObject({ name: "Main" }); // the server bootstrapped a first project
    await client.close();
  });

  it("does not need a browser session: the cookie gate applies to /api only", async () => {
    const api = await fetch(`${base}/api/projects`);
    expect(api.status).toBe(401);
    const mcp = await fetch(`${base}/mcp`, { method: "GET", headers: { Authorization: `Bearer ${mcpToken()}`, Accept: "text/event-stream" } });
    await mcp.body?.cancel();
    expect(mcp.status).not.toBe(401);
  });

  describe("client setup commands", () => {
    let cookie: string;

    beforeAll(async () => {
      const setup = await fetch(`${base}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery" }),
      });
      expect(setup.status).toBe(201);
      cookie = setup.headers.get("set-cookie")!.split(";")[0];
    });

    it.each([
      ["plain token", "test-setup-token"],
      ["shell metacharacters", "test-token'\"$HOME`printf expanded`"],
    ])("gives the owner usable commands for all three clients with a %s", async (_label, token) => {
      vi.stubEnv("MCP_TOKEN", token);
      try {
        const res = await fetch(`${base}/api/settings/mcp`, { headers: { Cookie: cookie } });
        expect(res.status).toBe(200);
        const info: McpInfo = await res.json();
        expect(info.url).toBe(`${base}/mcp`);
        expect(info.token).toBe(token);

        // Shell functions capture arguments without launching a client or making network calls.
        const args = (command: string) => execFileSync("/bin/sh", ["-c",
          'claude() { printf "%s\\0" "$@"; }; codex() { printf "%s\\0" "$@"; }; agy() { printf "%s\\0" "$@"; }; ' + command,
        ], { encoding: "utf8" }).split("\0").slice(0, -1);

        expect(args(info.claudeCode)).toEqual([
          "mcp", "add", "--transport", "http", "quack-aloud", info.url, "--header", `Authorization: Bearer ${token}`,
        ]);
        // agy requires flags before the name and detects HTTP without --type.
        expect(args(info.antigravity)).toEqual([
          "mcp", "add", "--header", `Authorization: Bearer ${token}`, "quack-aloud", info.url,
        ]);
        expect(args(info.codex)).toEqual([
          "mcp", "add", "quack-aloud", "--url", info.url, "--bearer-token-env-var", "QUACK_ALOUD_MCP_TOKEN",
        ]);
        expect(info.codexConfig).toContain(`url = "${info.url}"`);
        expect(info.codexConfig).toContain('bearer_token_env_var = "QUACK_ALOUD_MCP_TOKEN"');
        expect(info.codex + info.codexConfig).not.toContain(token);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
});
