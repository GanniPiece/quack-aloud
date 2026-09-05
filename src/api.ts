import type { Graph } from "../shared/graph";

async function json<T>(res: globalThis.Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

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

export interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<HealthInfo>(r)),

  listProjects: () => fetch("/api/projects").then((r) => json<ProjectInfo[]>(r)),
  createProject: (name: string) =>
    fetch("/api/projects", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then((r) =>
      json<{ id: string; graph: Graph }>(r),
    ),
  renameProject: (id: string, name: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then(
      (r) => json<{ id: string; graph: Graph }>(r),
    ),
  deleteProject: (id: string) =>
    fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => json<{ ok: true; replacement: string | null }>(r)),

  getGraph: (project: string) => fetch(`/api/graph?project=${encodeURIComponent(project)}`).then((r) => json<Graph>(r)),
  /** Resolves with the saved graph, or rejects with ConflictError carrying the server's current graph. */
  putGraph: async (project: string, graph: Graph, baseSig: string): Promise<Graph> => {
    const res = await fetch("/api/graph", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ project, graph, baseSig }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { error: string; graph: Graph };
      throw new ConflictError(body.error, body.graph);
    }
    return json<Graph>(res);
  },
  reset: (project: string) =>
    fetch("/api/graph/reset", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ project }) }).then((r) => json<Graph>(r)),
  /** Creates a new project from an exported file. */
  importGraph: (name: string, data: unknown) =>
    fetch("/api/graph/import", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name, graph: data }) }).then((r) =>
      json<{ id: string; graph: Graph }>(r),
    ),
  think: (project: string, message: string, guide: boolean) =>
    fetch("/api/think", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ project, message, guide }),
    }).then((r) => json<{ reply: string; graph: Graph }>(r)),
};
