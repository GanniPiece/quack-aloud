import { emptyGraph, type Graph } from "../shared/graph";
import { applyThinkResult } from "./graph";
import {
  createCanvas,
  createProject,
  defaultCanvas,
  ensureMigrated,
  ensureOneProject,
  listProjects,
  loadCanvas,
  projectExists,
  saveCanvas,
} from "./projects";
import type { ThinkOutput } from "./providers/types";

/**
 * The MCP tools as plain functions, so they can be unit-tested and reused by any transport.
 * They work on the project files directly (same folder the app watches), so the browser
 * updates live and no sign-in is involved.
 */

export function listProjectsTool() {
  ensureMigrated();
  ensureOneProject();
  return listProjects().map((p) => ({
    id: p.id,
    name: p.name,
    canvases: p.canvases.map((c) => ({ id: c.id, name: c.name, cards: c.nodeCount, updatedAt: new Date(c.updatedAt).toISOString() })),
  }));
}

export function resolveCanvas(project: string, canvas?: string): { pid: string; cid: string; graph: Graph } {
  if (!projectExists(project)) throw new Error(`No project "${project}". Call list_projects first.`);
  const cid = canvas ?? defaultCanvas(project);
  const graph = cid ? loadCanvas(project, cid) : null;
  if (!cid || !graph) throw new Error(`No canvas "${canvas ?? ""}" in project "${project}".`);
  return { pid: project, cid, graph };
}

/** The canvas without coordinates or provenance: what an agent needs to decide what to add. */
export function readCanvasTool(input: { project: string; canvas?: string; messages?: number }) {
  const { pid, cid, graph } = resolveCanvas(input.project, input.canvas);
  const keep = input.messages ?? 10;
  return {
    project: pid,
    canvas: cid,
    name: graph.name,
    layout: graph.layout ?? graph.suggestedLayout ?? "themes",
    root: graph.root ?? null,
    groups: graph.groups,
    nodes: graph.nodes.map(({ id, label, detail, origin, kind, group, seq }) => ({ id, label, detail, origin, kind, group, seq })),
    edges: graph.edges.map(({ source, target, label, origin }) => ({ source, target, label, origin })),
    recentMessages: graph.messages.slice(-keep),
  };
}

export function createProjectTool(input: { name: string; canvasName?: string }) {
  const created = createProject(input.name, emptyGraph(), input.canvasName ?? "Main");
  return { project: created.id, canvas: created.canvas, name: input.name };
}

export function createCanvasTool(input: { project: string; name: string }) {
  const created = createCanvas(input.project, input.name);
  if (!created) throw new Error(`No project "${input.project}". Call list_projects first.`);
  return { project: input.project, canvas: created.id, name: input.name };
}

export type DuckTurnInput = ThinkOutput & { project: string; canvas?: string; message: string; guide?: boolean };

/**
 * One turn of the duck, exactly as the in-app chat does it: the agent supplies the decomposition
 * (cards, groups, edges, refinements) and this applies placement, id collisions, hierarchy,
 * message history, and the organise-only filter, then saves the canvas.
 */
export function duckTurnTool(input: DuckTurnInput) {
  const { pid, cid, graph } = resolveCanvas(input.project, input.canvas);
  const { project: _p, canvas: _c, message, guide, ...output } = input;
  void _p;
  void _c;
  const before = new Set(graph.nodes.map((n) => n.id));
  const next = saveCanvas(pid, cid, applyThinkResult(graph, message, output, { guide: guide === true }));
  const added = next.nodes.filter((n) => !before.has(n.id));
  return {
    project: pid,
    canvas: cid,
    reply: next.messages[next.messages.length - 1]?.content ?? output.reply,
    added: added.map((n) => ({ id: n.id, label: n.label, kind: n.kind, origin: n.origin, group: n.group ?? null })),
    totals: { cards: next.nodes.length, edges: next.edges.length, groups: next.groups.length },
    droppedDuckCards: guide ? 0 : output.nodes.filter((n) => n.origin === "ai" || ["question", "insight", "todo", "challenge"].includes(n.kind)).length,
  };
}
