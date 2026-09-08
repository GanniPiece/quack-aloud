import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { DATA_DIR } from "./graph";

/**
 * Single shared password with signed session cookies. Enough for a self-hosted tool that
 * one person or a small group runs; the API key it protects pays for every message.
 *
 *   data/auth.json   { passwordHash, salt, sessionSecret }   (mode 0600)
 *   APP_PASSWORD     alternative for containers; verified against a hash computed at start
 *   AUTH_DISABLED=1  explicit opt-out for a machine nobody else can reach
 */
export const AUTH_PATH = path.join(DATA_DIR, "auth.json");
export const COOKIE = "qa_session";
export const MIN_PASSWORD = 8;
const SESSION_DAYS = 30;
const LOCK_AFTER = 5; // failed attempts
const LOCK_MS = 30_000;

interface AuthFile {
  passwordHash: string;
  salt: string;
  sessionSecret: string;
}

function readAuth(): AuthFile | null {
  try {
    const raw = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8")) as Partial<AuthFile>;
    if (raw && typeof raw.passwordHash === "string" && typeof raw.salt === "string" && typeof raw.sessionSecret === "string") return raw as AuthFile;
  } catch {
    /* no file */
  }
  return null;
}

function writeAuth(a: AuthFile) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${AUTH_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(a, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, AUTH_PATH);
  try {
    fs.chmodSync(AUTH_PATH, 0o600);
  } catch {
    /* not every filesystem supports it */
  }
}

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// The environment password is hashed once so the plain text is not compared repeatedly
let envAuth: AuthFile | null = null;
function envPassword(): AuthFile | null {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  if (!envAuth) {
    const salt = crypto.randomBytes(16).toString("hex");
    envAuth = { salt, passwordHash: hash(pw, salt), sessionSecret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex") };
  }
  return envAuth;
}

function current(): AuthFile | null {
  return readAuth() ?? envPassword();
}

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1" || process.env.AUTH_DISABLED === "true";
}

/** Is a password configured (file or environment)? When false, the app shows the setup screen. */
export function hasPassword(): boolean {
  return current() !== null;
}

export function passwordSource(): "file" | "env" | "none" {
  if (readAuth()) return "file";
  if (envPassword()) return "env";
  return "none";
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password must be text";
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  return null;
}

/** Sets or replaces the password. Rotates the session secret, so every existing session ends. */
export function setPassword(pw: string): void {
  const salt = crypto.randomBytes(16).toString("hex");
  writeAuth({ salt, passwordHash: hash(pw, salt), sessionSecret: crypto.randomBytes(32).toString("hex") });
}

export function verifyPassword(pw: string): boolean {
  const a = current();
  if (!a) return false;
  return equal(hash(pw, a.salt), a.passwordHash);
}

// ---------- sessions ----------

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Token = expiry.nonce.signature; nothing is stored server-side, the secret is the state. */
export function issueSession(now = Date.now()): string {
  const a = current();
  if (!a) throw new Error("No password configured");
  const payload = `${now + SESSION_DAYS * 86_400_000}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload, a.sessionSecret)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const a = current();
  if (!a) return false;
  const i = token.lastIndexOf(".");
  if (i < 0) return false;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  if (!equal(sign(payload, a.sessionSecret), sig)) return false;
  const expires = Number(payload.split(".")[0]);
  return Number.isFinite(expires) && expires > now;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function secure(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

export function setSessionCookie(req: Request, res: Response, token: string) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_DAYS * 86_400}`];
  if (secure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req: Request, res: Response) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function isAuthenticated(req: Request): boolean {
  if (authDisabled()) return true;
  return verifySession(parseCookies(req.headers.cookie)[COOKIE]);
}

// ---------- brute-force lock ----------

const failures = new Map<string, { count: number; until: number }>();

export function loginLocked(ip: string, now = Date.now()): number {
  const f = failures.get(ip);
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0;
}

export function recordLogin(ip: string, ok: boolean, now = Date.now()) {
  if (ok) {
    failures.delete(ip);
    return;
  }
  const f = failures.get(ip) ?? { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOCK_AFTER) {
    f.until = now + LOCK_MS;
    f.count = 0;
  }
  failures.set(ip, f);
}

/** Express middleware: everything under /api except the auth endpoints needs a session. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/api/auth/")) return next();
  if (!req.path.startsWith("/api/")) return next();
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Sign in to continue.", authRequired: true });
}
