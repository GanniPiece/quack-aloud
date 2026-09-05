import { useCallback, useEffect, useRef, useState } from "react";
import { graphSignature, type Graph } from "../shared/graph";
import { ConflictError, api, type ProjectInfo } from "./api";

const PERSIST_DEBOUNCE_MS = 400;

/**
 * Single source of truth for the current project's graph, plus the live project list.
 * - One SSE connection: "graph" events for the selected project, "projects" events for the list
 * - Local changes go through update(); an effect then debounces a PUT back to the server
 *   (persistence lives in an effect, never inside the state updater, because React may
 *   replay updaters in dev and during hot reload)
 * - Echoes of our own saves are filtered by signature so a drag is never snapped back
 * - Every PUT carries the signature of the last server version we saw; if the server has
 *   moved on it answers 409 and we adopt its version instead of overwriting it
 */
export function useGraph(project: string | null, onConflict?: (message: string) => void) {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [connected, setConnected] = useState(false);
  const recentlySent = useRef<string[]>([]);
  const baseSig = useRef<string>("");
  const dirty = useRef(false);
  const pending = useRef<Graph | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const projectRef = useRef(project);
  projectRef.current = project;

  useEffect(() => {
    // Switching projects: drop the old canvas and any unsaved debounced change for it
    clearTimeout(timer.current);
    pending.current = null;
    dirty.current = false;
    recentlySent.current = [];
    baseSig.current = "";
    setGraph(null);

    const url = project ? `/api/events?project=${encodeURIComponent(project)}` : "/api/events";
    const es = new EventSource(url);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("projects", (ev) => setProjects(JSON.parse((ev as MessageEvent).data) as ProjectInfo[]));
    es.addEventListener("graph", (ev) => {
      const { project: id, graph: incoming } = JSON.parse((ev as MessageEvent).data) as { project: string; graph: Graph };
      if (id !== projectRef.current) return;
      const sig = graphSignature(incoming);
      baseSig.current = sig; // whatever the server holds now is our new base, echo or not
      if (recentlySent.current.includes(sig)) return;
      setGraph((prev) => (prev && graphSignature(prev) === sig ? prev : incoming));
    });
    return () => es.close();
  }, [project]);

  const flush = useCallback(() => {
    const g = pending.current;
    const id = projectRef.current;
    pending.current = null;
    if (!g || !id) return;
    const sig = graphSignature(g);
    recentlySent.current = [...recentlySent.current.slice(-4), sig];
    api
      .putGraph(id, g, baseSig.current)
      .then(() => {
        baseSig.current = sig;
      })
      .catch((err) => {
        if (err instanceof ConflictError) {
          baseSig.current = graphSignature(err.graph);
          setGraph(err.graph);
          onConflict?.(err.message);
        } else {
          console.error("[graph] save failed", err);
        }
      });
  }, [onConflict]);

  // Persist local changes: runs once per committed graph, only when update() marked it dirty.
  useEffect(() => {
    if (!graph || !dirty.current) return;
    dirty.current = false;
    pending.current = graph;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
  }, [graph, flush]);

  const update = useCallback((fn: (g: Graph) => Graph) => {
    dirty.current = true;
    setGraph((prev) => (prev ? fn(prev) : prev));
  }, []);

  /** Adopt a graph the server already saved (e.g. the /api/think result) without PUTting it back. */
  const adopt = useCallback((g: Graph) => {
    const sig = graphSignature(g);
    recentlySent.current = [...recentlySent.current.slice(-4), sig];
    baseSig.current = sig;
    setGraph(g);
  }, []);

  return { graph, projects, connected, update, adopt };
}
