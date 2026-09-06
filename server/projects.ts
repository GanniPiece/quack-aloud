import fs from "node:fs";
import path from "node:path";
import { emptyGraph, type Graph } from "../shared/graph";
import { DATA_DIR, normalize } from "./graph";

export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
/** Deleted projects are moved here, never removed outright. */
export const TRASH_DIR = path.join(DATA_DIR, "trash");
const LEGACY_GRAPH = path.join(DATA_DIR, "graph.json");
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_NAME = "Untitled project";

export interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: number;
  nodeCount: number;
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

export function projectPath(id: string): string {
  if (!isValidId(id)) throw new Error(`Invalid project id "${id}"`);
  return path.join(PROJECTS_DIR, `${id}.json`);
}

/** First run on an older data folder: turn data/graph.json into the first project. */
export function ensureMigrated(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (!fs.existsSync(LEGACY_GRAPH)) return;
  try {
    const graph = normalize(JSON.parse(fs.readFileSync(LEGACY_GRAPH, "utf8")));
    const id = uniqueId(newProjectId());
    writeGraph(id, { ...graph, name: graph.name ?? "My project" });
    fs.renameSync(LEGACY_GRAPH, `${LEGACY_GRAPH}.migrated`);
    console.log(`[projects] moved data/graph.json into projects/${id}.json`);
  } catch (err) {
    console.warn("[projects] could not migrate data/graph.json:", (err as Error).message);
  }
}

export function listProjects(): ProjectInfo[] {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const out: ProjectInfo[] = [];
  for (const file of fs.readdirSync(PROJECTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    if (!isValidId(id)) continue;
    try {
      const g = normalize(JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, file), "utf8")));
      out.push({ id, name: g.name ?? DEFAULT_NAME, updatedAt: g.updatedAt, nodeCount: g.nodes.length });
    } catch {
      // half-written or broken file: skip it for now
    }
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadProject(id: string): Graph | null {
  const file = projectPath(id);
  if (!fs.existsSync(file)) return null;
  return normalize(JSON.parse(fs.readFileSync(file, "utf8")));
}

/** Writes atomically and stamps updatedAt. */
export function saveProject(id: string, graph: Graph): Graph {
  return writeGraph(id, graph);
}

/** Ids are timestamps (`p-20260905-153012`), so any name in any language works and files sort by creation. */
export function newProjectId(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `p-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export function createProject(name: string, graph: Graph = emptyGraph()): { id: string; graph: Graph } {
  const cleanName = name.trim() || DEFAULT_NAME;
  const id = uniqueId(newProjectId());
  const saved = writeGraph(id, { ...graph, name: cleanName });
  return { id, graph: saved };
}

export function renameProject(id: string, name: string): Graph | null {
  const g = loadProject(id);
  if (!g) return null;
  return writeGraph(id, { ...g, name: name.trim() || DEFAULT_NAME });
}

/**
 * Moves the project file to data/trash/<id>-<timestamp>.json. If that was the last project,
 * a fresh empty one is created so the app always has somewhere to type. Returns the id of
 * the replacement when one was created.
 */
export function deleteProject(id: string): { deleted: boolean; replacement?: string } {
  const file = projectPath(id);
  if (!fs.existsSync(file)) return { deleted: false };
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.renameSync(file, path.join(TRASH_DIR, `${id}-${stamp}.json`));
  const replacement = listProjects().length === 0 ? ensureOneProject() : undefined;
  return { deleted: true, replacement };
}

/** Creates "My project" when the folder is empty; returns the id of the project that exists. */
export function ensureOneProject(): string {
  const existing = listProjects();
  if (existing.length > 0) return existing[0].id;
  return createProject("My project").id;
}

function writeGraph(id: string, graph: Graph): Graph {
  const next: Graph = { ...normalize(graph), updatedAt: Date.now() };
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const file = projectPath(id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return next;
}

function uniqueId(base: string): string {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  let id = base;
  for (let i = 2; fs.existsSync(path.join(PROJECTS_DIR, `${id}.json`)); i++) id = `${base}-${i}`;
  return id;
}
