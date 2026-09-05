import type { Graph } from "../shared/graph";

async function json<T>(res: globalThis.Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

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
  graphPath: string;
}

export const api = {
  health: () => fetch("/api/health").then((r) => json<HealthInfo>(r)),
  getGraph: () => fetch("/api/graph").then((r) => json<Graph>(r)),
  /** Resolves with the saved graph, or rejects with ConflictError carrying the server's current graph. */
  putGraph: async (graph: Graph, baseSig: string): Promise<Graph> => {
    const res = await fetch("/api/graph", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph, baseSig }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as { error: string; graph: Graph };
      throw new ConflictError(body.error, body.graph);
    }
    return json<Graph>(res);
  },
  reset: () => fetch("/api/graph/reset", { method: "POST" }).then((r) => json<Graph>(r)),
  importGraph: (data: unknown) =>
    fetch("/api/graph/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).then((r) => json<Graph>(r)),
  think: (message: string, guide: boolean) =>
    fetch("/api/think", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, guide }),
    }).then((r) => json<{ reply: string; graph: Graph }>(r)),
};
