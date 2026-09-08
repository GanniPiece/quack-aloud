import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DATA_DIR } from "./graph";
import { createMcpServer } from "./mcp";

/**
 * The duck's MCP tools as an HTTP endpoint (/mcp, Streamable HTTP, stateless), so the MCP
 * server starts with the app (Docker, Kubernetes) and remote agents can connect:
 *   claude mcp add --transport http quack-aloud http://host:8787/mcp --header "Authorization: Bearer <token>"
 * The token lives in data/auth.json (or MCP_TOKEN); the owner sees and rotates it in Settings.
 */
const AUTH_PATH = path.join(DATA_DIR, "auth.json");

function readAuthFile(): Record<string, unknown> {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeAuthFile(next: Record<string, unknown>) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${AUTH_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, AUTH_PATH);
  try {
    fs.chmodSync(AUTH_PATH, 0o600);
  } catch {
    /* not every filesystem supports it */
  }
}

const newToken = () => crypto.randomBytes(32).toString("base64url");

/** The bearer token agents must present. MCP_TOKEN overrides the stored one. */
export function mcpToken(): string {
  if (process.env.MCP_TOKEN) return process.env.MCP_TOKEN;
  const a = readAuthFile();
  if (typeof a.mcpToken === "string" && a.mcpToken) return a.mcpToken;
  const token = newToken();
  writeAuthFile({ ...a, mcpToken: token });
  return token;
}

export function mcpTokenSource(): "env" | "file" {
  return process.env.MCP_TOKEN ? "env" : "file";
}

export function rotateMcpToken(): string {
  const token = newToken();
  writeAuthFile({ ...readAuthFile(), mcpToken: token });
  return token;
}

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim();
}

function tokenOk(req: Request): boolean {
  const given = bearer(req);
  if (!given) return false;
  const expected = mcpToken();
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Mounts /mcp. Stateless: a fresh server + transport per request, nothing kept between calls. */
export function mountMcp(app: Express) {
  app.all("/mcp", async (req: Request, res: Response) => {
    if (!tokenOk(req)) {
      res.status(401).json({ error: "MCP needs a bearer token. Find it in Settings › MCP." });
      return;
    }
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("[mcp/http]", err);
      if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
    }
  });
}
