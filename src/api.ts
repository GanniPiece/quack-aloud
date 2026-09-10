import type { Graph } from "../shared/graph";

async function json<T>(res: globalThis.Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && (body as { authRequired?: boolean }).authRequired) {
    window.dispatchEvent(new Event("qa:unauthorized"));
  }
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const q = (project: string, canvas: string) => `project=${encodeURIComponent(project)}&canvas=${encodeURIComponent(canvas)}`;

export class ConflictError extends Error {
  constructor(message: string, public readonly graph: Graph) {
    super(message);
    this.name = "ConflictError";
  }
}

export interface HealthInfo {
  ok: boolean;
  provider: string;
  model: string;
  effort: string | null;
  keyConfigured: boolean;
  projectsDir: string;
}

export interface AuthUser {
  email: string;
  role: "owner" | "member";
}

export interface AuthStatus {
  authRequired: boolean;
  configured: boolean;
  user: AuthUser | null;
}

export interface UserRecord extends AuthUser {
  id: string;
  createdAt: number;
}

export interface ProviderSettingsInfo {
  model: string;
  defaultModel: string;
  keyPlaceholder: string;
  effort: string | null;
  efforts: string[];
  keyConfigured: boolean;
  keyMasked: string | null;
  keySource: "settings" | "env" | "none";
}

export interface SettingsInfo extends ProviderSettingsInfo {
  provider: string;
  providers: string[];
  configurations: Record<string, ProviderSettingsInfo>;
}

export interface McpInfo {
  token: string;
  source: "env" | "file";
  url: string;
  claudeCode: string;
  codex: string;
  codexConfig: string;
}

export interface CanvasInfo {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

export interface ProjectInfo {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  canvases: CanvasInfo[];
}

/** A canvas is addressed by its project and its own id */
export interface CanvasRef {
  project: string;
  canvas: string;
}

export const api = {
  authStatus: () => fetch("/api/auth/status").then((r) => json<AuthStatus>(r)),
  authSetup: (email: string, password: string) =>
    fetch("/api/auth/setup", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password }) }).then((r) => json<{ ok: true }>(r)),
  authLogin: (email: string, password: string) =>
    fetch("/api/auth/login", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password }) }).then((r) => json<{ ok: true }>(r)),
  mcpInfo: () => fetch("/api/settings/mcp").then((r) => json<McpInfo>(r)),
  rotateMcpToken: () => fetch("/api/settings/mcp/rotate", { method: "POST" }).then((r) => json<{ token: string }>(r)),
  listUsers: () => fetch("/api/auth/users").then((r) => json<UserRecord[]>(r)),
  addUser: (email: string, password: string, role: "owner" | "member" = "member") =>
    fetch("/api/auth/users", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ email, password, role }) }).then((r) => json<UserRecord>(r)),
  removeUser: (id: string) => fetch(`/api/auth/users/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true }>(r)),
  authLogout: () => fetch("/api/auth/logout", { method: "POST" }).then((r) => json<{ ok: true }>(r)),
  changePassword: (current: string, password: string) =>
    fetch("/api/auth/password", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ current, password }) }).then((r) => json<{ ok: true }>(r)),

  health: () => fetch("/api/health").then((r) => json<HealthInfo>(r)),
  getSettings: () => fetch("/api/settings").then((r) => json<SettingsInfo>(r)),
  putSettings: (patch: { provider?: string; apiKey?: string; model?: string; effort?: string }) =>
    fetch("/api/settings", { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(patch) }).then((r) => json<SettingsInfo>(r)),

  listProjects: () => fetch("/api/projects").then((r) => json<ProjectInfo[]>(r)),
  createProject: (name: string) =>
    fetch("/api/projects", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then((r) =>
      json<{ id: string; canvas: string; graph: Graph }>(r),
    ),
  renameProject: (id: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  deleteProject: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true; replacement: string | null }>(r)),

  createCanvas: (project: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(project)}/canvases`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then(
      (r) => json<{ id: string; graph: Graph }>(r),
    ),
  renameCanvas: (ref: CanvasRef, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(ref.project)}/canvases/${encodeURIComponent(ref.canvas)}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    }).then((r) => json<{ id: string; graph: Graph }>(r)),
  deleteCanvas: (ref: CanvasRef) =>
    fetch(`/api/projects/${encodeURIComponent(ref.project)}/canvases/${encodeURIComponent(ref.canvas)}`, { method: "DELETE" }).then((r) =>
      json<{ ok: true; replacement: string | null }>(r),
    ),

  getGraph: (ref: CanvasRef) => fetch(`/api/graph?${q(ref.project, ref.canvas)}`).then((r) => json<Graph>(r)),
  /** Resolves with the saved graph, or rejects with ConflictError carrying the server's current graph. */
  putGraph: async (ref: CanvasRef, graph: Graph, baseSig: string): Promise<Graph> => {
    const res = await fetch("/api/graph", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...ref, graph, baseSig }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { error: string; graph: Graph };
      throw new ConflictError(body.error, body.graph);
    }
    return json<Graph>(res);
  },
  reset: (ref: CanvasRef) =>
    fetch("/api/graph/reset", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(ref) }).then((r) => json<Graph>(r)),
  /** Creates a new canvas in the project from an exported file. */
  importGraph: (project: string, name: string, data: unknown) =>
    fetch("/api/graph/import", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ project, name, graph: data }) }).then((r) =>
      json<{ id: string; graph: Graph }>(r),
    ),
  think: (ref: CanvasRef, message: string, guide: boolean) =>
    fetch("/api/think", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...ref, message, guide }),
    }).then((r) => json<{ reply: string; graph: Graph }>(r)),
};
