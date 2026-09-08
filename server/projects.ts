import fs from "node:fs";
import path from "node:path";
import { emptyGraph, type Graph } from "../shared/graph";
import { DATA_DIR, normalize } from "./graph";

/**
 * Storage layout (one folder per project, one file per canvas):
 *   data/projects/<pid>/project.json   { name, createdAt }
 *   data/projects/<pid>/<cid>.json     a Graph (the canvas; its `name` is the canvas name)
 * Deleted things go to data/trash/. Older flat files data/projects/<id>.json are migrated
 * into <id>/main.json on startup.
 */
export const PROJECTS_DIR = path.join(DATA_DIR, "projects");
export const TRASH_DIR = path.join(DATA_DIR, "trash");
const LEGACY_GRAPH = path.join(DATA_DIR, "graph.json");
const META_FILE = "project.json";
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_PROJECT_NAME = "Untitled project";
export const DEFAULT_CANVAS_NAME = "Main";

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

interface ProjectMeta {
  name: string;
  createdAt: number;
}

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id) && id !== "project";
}

function projectDir(pid: string): string {
  if (!isValidId(pid)) throw new Error(`Invalid project id "${pid}"`);
  return path.join(PROJECTS_DIR, pid);
}

export function canvasPath(pid: string, cid: string): string {
  if (!isValidId(cid)) throw new Error(`Invalid canvas id "${cid}"`);
  return path.join(projectDir(pid), `${cid}.json`);
}

/** Ids are timestamps, so any name in any language works and entries sort by creation. */
export function stampId(prefix: "p" | "c", now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function uniqueId(base: string, taken: (id: string) => boolean): string {
  let id = base;
  for (let i = 2; taken(id); i++) id = `${base}-${i}`;
  return id;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

// ---------- migration ----------

/** Bring older layouts up to date: data/graph.json and flat data/projects/<id>.json files. */
export function ensureMigrated(): void {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  if (fs.existsSync(LEGACY_GRAPH)) {
    const g = readJson<Graph>(LEGACY_GRAPH);
    if (g) {
      const { id } = createProject(normalize(g).name ?? "My project", normalize(g));
      fs.renameSync(LEGACY_GRAPH, `${LEGACY_GRAPH}.migrated`);
      console.log(`[projects] moved data/graph.json into projects/${id}/`);
    }
  }
  for (const file of fs.readdirSync(PROJECTS_DIR)) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const flat = path.join(PROJECTS_DIR, file);
    if (!isValidId(id) || !fs.statSync(flat).isFile()) continue;
    const g = readJson<Graph>(flat);
    if (!g) continue;
    const graph = normalize(g);
    const dir = projectDir(id);
    fs.mkdirSync(dir, { recursive: true });
    writeJsonAtomic(path.join(dir, META_FILE), { name: graph.name ?? DEFAULT_PROJECT_NAME, createdAt: graph.updatedAt || Date.now() } satisfies ProjectMeta);
    fs.renameSync(flat, path.join(dir, "main.json"));
    writeCanvas(id, "main", { ...graph, name: DEFAULT_CANVAS_NAME });
    console.log(`[projects] moved projects/${file} into projects/${id}/main.json`);
  }
}

/** Creates "My project" when the folder is empty; returns the id of a project that exists. */
export function ensureOneProject(): string {
  const existing = listProjects();
  if (existing.length > 0) return existing[0].id;
  return createProject("My project").id;
}

// ---------- reading ----------

function readMeta(pid: string): ProjectMeta {
  const meta = readJson<Partial<ProjectMeta>>(path.join(projectDir(pid), META_FILE));
  return {
    name: typeof meta?.name === "string" && meta.name.trim() ? meta.name.trim() : DEFAULT_PROJECT_NAME,
    createdAt: Number.isFinite(meta?.createdAt) ? (meta!.createdAt as number) : 0,
  };
}

export function listCanvases(pid: string): CanvasInfo[] {
  const dir = projectDir(pid);
  if (!fs.existsSync(dir)) return [];
  const out: CanvasInfo[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json") || file === META_FILE) continue;
    const cid = file.slice(0, -5);
    if (!isValidId(cid)) continue;
    const g = readJson<Graph>(path.join(dir, file));
    if (!g) continue; // half-written or broken file: skip it for now
    const graph = normalize(g);
    out.push({ id: cid, name: graph.name ?? DEFAULT_CANVAS_NAME, updatedAt: graph.updatedAt, nodeCount: graph.nodes.length });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listProjects(): ProjectInfo[] {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const out: ProjectInfo[] = [];
  for (const entry of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !isValidId(entry.name)) continue;
    const meta = readMeta(entry.name);
    const canvases = listCanvases(entry.name);
    out.push({
      id: entry.name,
      name: meta.name,
      createdAt: meta.createdAt,
      updatedAt: Math.max(meta.createdAt, ...canvases.map((c) => c.updatedAt)),
      canvases,
    });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function projectExists(pid: string): boolean {
  return isValidId(pid) && fs.existsSync(path.join(projectDir(pid), META_FILE));
}

export function loadCanvas(pid: string, cid: string): Graph | null {
  const file = canvasPath(pid, cid);
  if (!fs.existsSync(file)) return null;
  const g = readJson<Graph>(file);
  return g ? normalize(g) : null;
}

/** The canvas to open when none is named: the most recently updated one. */
export function defaultCanvas(pid: string): string | null {
  return listCanvases(pid)[0]?.id ?? null;
}

// ---------- writing ----------

function writeCanvas(pid: string, cid: string, graph: Graph): Graph {
  const next: Graph = { ...normalize(graph), updatedAt: Date.now() };
  writeJsonAtomic(canvasPath(pid, cid), next);
  return next;
}

export function saveCanvas(pid: string, cid: string, graph: Graph): Graph {
  return writeCanvas(pid, cid, graph);
}

export function createProject(name: string, firstCanvas: Graph = emptyGraph(), canvasName = DEFAULT_CANVAS_NAME): { id: string; canvas: string; graph: Graph } {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
  const id = uniqueId(stampId("p"), (x) => fs.existsSync(path.join(PROJECTS_DIR, x)));
  writeJsonAtomic(path.join(projectDir(id), META_FILE), { name: name.trim() || DEFAULT_PROJECT_NAME, createdAt: Date.now() } satisfies ProjectMeta);
  const created = createCanvas(id, firstCanvas.name && firstCanvas.name !== DEFAULT_PROJECT_NAME ? firstCanvas.name : canvasName, firstCanvas);
  return { id, canvas: created!.id, graph: created!.graph };
}

export function createCanvas(pid: string, name: string, graph: Graph = emptyGraph()): { id: string; graph: Graph } | null {
  if (!projectExists(pid)) return null;
  const id = uniqueId(stampId("c"), (x) => fs.existsSync(canvasPath(pid, x)));
  const saved = writeCanvas(pid, id, { ...graph, name: name.trim() || DEFAULT_CANVAS_NAME });
  return { id, graph: saved };
}

export function renameProject(pid: string, name: string): boolean {
  if (!projectExists(pid)) return false;
  const meta = readMeta(pid);
  writeJsonAtomic(path.join(projectDir(pid), META_FILE), { ...meta, name: name.trim() || DEFAULT_PROJECT_NAME });
  return true;
}

export function renameCanvas(pid: string, cid: string, name: string): Graph | null {
  const g = loadCanvas(pid, cid);
  if (!g) return null;
  return writeCanvas(pid, cid, { ...g, name: name.trim() || DEFAULT_CANVAS_NAME });
}

function trashStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/** Moves the whole project folder to trash. If it was the last project, a fresh one is created. */
export function deleteProject(pid: string): { deleted: boolean; replacement?: string } {
  if (!projectExists(pid)) return { deleted: false };
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  fs.renameSync(projectDir(pid), path.join(TRASH_DIR, `${pid}-${trashStamp()}`));
  const replacement = listProjects().length === 0 ? ensureOneProject() : undefined;
  return { deleted: true, replacement };
}

/** Moves one canvas to trash. If it was the project's last canvas, an empty one is created. */
export function deleteCanvas(pid: string, cid: string): { deleted: boolean; replacement?: string } {
  const file = canvasPath(pid, cid);
  if (!fs.existsSync(file)) return { deleted: false };
  fs.mkdirSync(TRASH_DIR, { recursive: true });
  fs.renameSync(file, path.join(TRASH_DIR, `${pid}-${cid}-${trashStamp()}.json`));
  const replacement = listCanvases(pid).length === 0 ? createCanvas(pid, DEFAULT_CANVAS_NAME)?.id : undefined;
  return { deleted: true, replacement };
}
