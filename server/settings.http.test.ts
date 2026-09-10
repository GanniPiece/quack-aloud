import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "quack-settings-http-"));
process.env.DOTENV_CONFIG_PATH = "/dev/null";
for (const name of ["AUTH_DISABLED", "APP_EMAIL", "APP_PASSWORD", "PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_MODEL", "CLAUDE_EFFORT", "OPENAI_MODEL", "OPENAI_EFFORT"]) delete process.env[name];
const { createApp } = await import("./app");
const { createUser } = await import("./auth");
let http: Server;
let base: string;
let owner: string;
let member: string;
const headers = (cookie: string) => ({ Cookie: cookie, "Content-Type": "application/json" });

beforeAll(async () => {
  createUser("owner@test.local", "test-password", "owner");
  createUser("member@test.local", "test-password", "member");
  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    http = app.listen(0, "127.0.0.1", () => resolve());
    http.once("error", reject);
  });
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const login = async (email: string) => {
    const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: headers(""), body: JSON.stringify({ email, password: "test-password" }) });
    expect(res.status).toBe(200);
    return res.headers.get("set-cookie")!.split(";")[0];
  };
  owner = await login("owner@test.local");
  member = await login("member@test.local");
});
afterAll(() => new Promise<void>((resolve) => http.close(() => resolve())));

describe("browser provider settings", () => {
  it("switches providers while restoring their own model, effort, and key status", async () => {
    for (const patch of [
      { provider: "claude", model: "claude-custom", effort: "max", apiKey: "anthropic-private-test-key" },
      { provider: "openai", model: "gpt-5.4-mini", effort: "none", apiKey: "openai-private-test-key" },
    ]) {
      const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: headers(owner), body: JSON.stringify(patch) });
      expect(res.status).toBe(200);
    }
    const res = await fetch(`${base}/api/settings`, { headers: headers(owner) });
    const text = await res.text();
    expect(text).not.toContain("openai-private-test-key");
    expect(text).not.toContain("anthropic-private-test-key");
    const settings = JSON.parse(text);
    expect(settings.provider).toBe("openai");
    expect(settings.configurations.claude).toMatchObject({ model: "claude-custom", effort: "max", keyConfigured: true });
    expect(settings.configurations.openai).toMatchObject({ model: "gpt-5.4-mini", effort: "none", keyConfigured: true });
    expect(settings.configurations.openai.efforts).not.toContain("max");
    expect(settings.configurations.claude.efforts).not.toContain("none");
    const switched = await fetch(`${base}/api/settings`, { method: "PUT", headers: headers(owner), body: '{"provider":"claude"}' });
    expect(await switched.json()).toMatchObject({ provider: "claude", model: "claude-custom", effort: "max" });
  });

  it("validates effort for the target provider without changing the current selection", async () => {
    const before = await (await fetch(`${base}/api/settings`, { headers: headers(owner) })).json();
    const res = await fetch(`${base}/api/settings`, { method: "PUT", headers: headers(owner), body: '{"provider":"openai","effort":"max"}' });
    expect(res.status).toBe(400);
    const after = await (await fetch(`${base}/api/settings`, { headers: headers(owner) })).json();
    expect(after).toEqual(before);
  });

  it("allows members to view settings but only owners to change shared credentials/provider", async () => {
    expect((await fetch(`${base}/api/settings`, { headers: headers(member) })).status).toBe(200);
    expect((await fetch(`${base}/api/settings`, { method: "PUT", headers: headers(member), body: '{"provider":"openai"}' })).status).toBe(403);
    expect((await fetch(`${base}/api/settings/mcp`, { headers: headers(member) })).status).toBe(403);
  });

  it("provides token-free Codex setup text alongside the Claude Code command", async () => {
    const res = await fetch(`${base}/api/settings/mcp`, { headers: headers(owner) });
    expect(res.status).toBe(200);
    const info = await res.json();
    expect(info.codex).toContain("--bearer-token-env-var QUACK_ALOUD_MCP_TOKEN");
    expect(info.codex).toContain(`${base}/mcp`);
    expect(info.codexConfig).toContain(`url = "${base}/mcp"`);
    expect(info.codexConfig).toContain('bearer_token_env_var = "QUACK_ALOUD_MCP_TOKEN"');
    expect(info.codex + info.codexConfig).not.toContain(info.token);
    expect(info.claudeCode).toContain("claude mcp add");
  });
});
