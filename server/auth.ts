import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { DATA_DIR } from "./graph";

/**
 * Accounts (email + password) with signed session cookies.
 *
 *   data/users.json  [{ id, email, passwordHash, salt, role, sessionVersion, createdAt }]  (mode 0600)
 *   data/auth.json   { sessionSecret }                                                     (mode 0600)
 *   APP_EMAIL + APP_PASSWORD  seed the first owner on startup when there are no users (containers)
 *   AUTH_DISABLED=1           explicit opt-out for a machine nobody else can reach
 *
 * The first account is the owner and can add or remove members in Settings. Projects are
 * shared by everyone who can sign in; accounts control the door, not the data.
 */
export const USERS_PATH = path.join(DATA_DIR, "users.json");
export const AUTH_PATH = path.join(DATA_DIR, "auth.json");
export const COOKIE = "qa_session";
export const MIN_PASSWORD = 8;
const SESSION_DAYS = 30;
const LOCK_AFTER = 5; // failed attempts
const LOCK_MS = 30_000;

export type Role = "owner" | "member";

export interface User {
  id: string;
  email: string;
  role: Role;
  createdAt: number;
}

interface StoredUser extends User {
  passwordHash: string;
  salt: string;
  /** bumped on password change or deletion so existing sessions stop verifying */
  sessionVersion: number;
}

// ---------- files ----------

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writePrivate(file: string, value: unknown) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* not every filesystem supports it */
  }
}

function readUsers(): StoredUser[] {
  const raw = readJson<StoredUser[]>(USERS_PATH);
  return Array.isArray(raw) ? raw : [];
}

function writeUsers(users: StoredUser[]) {
  writePrivate(USERS_PATH, users);
}

function sessionSecret(): string {
  const a = readJson<{ sessionSecret?: string }>(AUTH_PATH);
  if (a?.sessionSecret) return a.sessionSecret;
  const secret = crypto.randomBytes(32).toString("hex");
  writePrivate(AUTH_PATH, { sessionSecret: secret });
  return secret;
}

// ---------- passwords ----------

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password.normalize("NFKC"), salt, 64).toString("hex");
}

function equal(a: string, b: string): boolean {
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: unknown): string | null {
  if (typeof email !== "string") return "Email must be text";
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That does not look like an email address";
  return null;
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== "string") return "Password must be text";
  if (pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`;
  return null;
}

const publicUser = ({ id, email, role, createdAt }: StoredUser): User => ({ id, email, role, createdAt });

export function authDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1" || process.env.AUTH_DISABLED === "true";
}

export function hasUsers(): boolean {
  return readUsers().length > 0;
}

export function listUsers(): User[] {
  return readUsers().map(publicUser);
}

export function getUser(id: string): User | null {
  const u = readUsers().find((x) => x.id === id);
  return u ? publicUser(u) : null;
}

/** The first account becomes the owner. Emails are unique, case-insensitively. */
export function createUser(email: string, password: string, role?: Role): User {
  const e = normalizeEmail(email);
  const problem = validateEmail(e) ?? validatePassword(password);
  if (problem) throw new Error(problem);
  const users = readUsers();
  if (users.some((u) => u.email === e)) throw new Error("An account with that email already exists");
  const salt = crypto.randomBytes(16).toString("hex");
  const user: StoredUser = {
    id: `u-${crypto.randomBytes(6).toString("hex")}`,
    email: e,
    role: role ?? (users.length === 0 ? "owner" : "member"),
    createdAt: Date.now(),
    passwordHash: hash(password, salt),
    salt,
    sessionVersion: 1,
  };
  writeUsers([...users, user]);
  return publicUser(user);
}

export function verifyLogin(email: string, password: string): User | null {
  const e = normalizeEmail(email);
  const u = readUsers().find((x) => x.email === e);
  // hash even when the user is unknown so timing does not reveal which emails exist
  const probe = u ?? { salt: "0".repeat(32), passwordHash: "0".repeat(128) };
  const ok = equal(hash(password, probe.salt), probe.passwordHash);
  return u && ok ? publicUser(u) : null;
}

/** New password for one user; ends that user's sessions only. */
export function changePassword(id: string, password: string): void {
  const problem = validatePassword(password);
  if (problem) throw new Error(problem);
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) throw new Error("No such user");
  u.salt = crypto.randomBytes(16).toString("hex");
  u.passwordHash = hash(password, u.salt);
  u.sessionVersion += 1;
  writeUsers(users);
}

/** Returns an error message, or null when the user was removed. */
export function deleteUser(id: string): string | null {
  const users = readUsers();
  const u = users.find((x) => x.id === id);
  if (!u) return "No such user";
  if (u.role === "owner" && users.filter((x) => x.role === "owner").length === 1) return "Cannot remove the last owner";
  writeUsers(users.filter((x) => x.id !== id));
  return null;
}

/** Containers: create the first owner from APP_EMAIL + APP_PASSWORD when there are no users yet. */
export function seedFromEnv(): boolean {
  const email = process.env.APP_EMAIL, password = process.env.APP_PASSWORD;
  if (!email || !password || hasUsers()) return false;
  createUser(email, password, "owner");
  return true;
}

// ---------- sessions ----------

function sign(payload: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Token = expiry.userId.sessionVersion.nonce.signature; the server stores no session state. */
export function issueSession(userId: string, now = Date.now()): string {
  const u = readUsers().find((x) => x.id === userId);
  if (!u) throw new Error("No such user");
  const payload = `${now + SESSION_DAYS * 86_400_000}.${u.id}.${u.sessionVersion}.${crypto.randomBytes(12).toString("base64url")}`;
  return `${payload}.${sign(payload, sessionSecret())}`;
}

export function verifySession(token: string | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i), sig = token.slice(i + 1);
  if (!equal(sign(payload, sessionSecret()), sig)) return null;
  const [expires, userId, version] = payload.split(".");
  if (!(Number(expires) > now)) return null;
  const u = readUsers().find((x) => x.id === userId);
  if (!u || String(u.sessionVersion) !== version) return null;
  return publicUser(u);
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

const LOCAL_USER: User = { id: "local", email: "local", role: "owner", createdAt: 0 };

/** The signed-in user, or a synthetic owner when authentication is disabled. */
export function currentUser(req: Request): User | null {
  if (authDisabled()) return LOCAL_USER;
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
  if (currentUser(req)) return next();
  res.status(401).json({ error: "Sign in to continue.", authRequired: true });
}
