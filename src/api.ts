import type { Graph } from "../shared/graph";

async function json<T>(res: globalThis.Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
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
  health: () => fetch("/api/health").then((r) => json<HealthInfo>(r)),

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
