import { useEffect, useRef, useState } from "react";
import type { CanvasRef, ProjectInfo } from "../api";

interface Props {
  projects: ProjectInfo[];
  current: CanvasRef | null;
  onSelect: (ref: CanvasRef) => void;
  onCreateProject: (name: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onCreateCanvas: (project: string, name: string) => void;
  onRenameCanvas: (ref: CanvasRef, name: string) => void;
  onDeleteCanvas: (ref: CanvasRef) => void;
}

const NEW = "__new__";
const RENAME = "__rename__";
const DELETE = "__delete__";

type Mode =
  | { kind: "idle" }
  | { kind: "new-project" }
  | { kind: "rename-project" }
  | { kind: "delete-project" }
  | { kind: "new-canvas" }
  | { kind: "rename-canvas" }
  | { kind: "delete-canvas" };

/**
 * Top-bar picker: Project › Canvas. A project is a folder of canvases (e.g. a novel with
 * "Concept", "Characters", "Chapter 1"). Creating and renaming use an inline text box (no
 * browser dialogs, which the embedded browser may block); deleting asks once, inline, and
 * times out.
 */
export function ProjectSwitcher({
  projects,
  current,
  onSelect,
  onCreateProject,
  onRenameProject,
  onDeleteProject,
  onCreateCanvas,
  onRenameCanvas,
  onDeleteCanvas,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const project = projects.find((p) => p.id === current?.project);
  const canvas = project?.canvases.find((c) => c.id === current?.canvas);
  const editing = mode.kind === "new-project" || mode.kind === "rename-project" || mode.kind === "new-canvas" || mode.kind === "rename-canvas";
  const confirming = mode.kind === "delete-project" || mode.kind === "delete-canvas";

  useEffect(() => {
    if (editing) {
      const t = setTimeout(() => {
        input.current?.focus();
        input.current?.select();
      }, 20);
      return () => clearTimeout(t);
    }
    if (confirming) {
      const t = setTimeout(() => setMode({ kind: "idle" }), 4000);
      return () => clearTimeout(t);
    }
  }, [editing, confirming, mode.kind]);

  const begin = (next: Mode, initial = "") => {
    setText(initial);
    setMode(next);
  };

  const commit = () => {
    const name = text.trim();
    switch (mode.kind) {
      case "new-project":
        if (name) onCreateProject(name);
        break;
      case "rename-project":
        if (project && name && name !== project.name) onRenameProject(project.id, name);
        break;
      case "new-canvas":
        if (project && name) onCreateCanvas(project.id, name);
        break;
      case "rename-canvas":
        if (current && canvas && name && name !== canvas.name) onRenameCanvas(current, name);
        break;
    }
    setMode({ kind: "idle" });
  };

  if (editing) {
    const placeholder =
      mode.kind === "new-project" ? "New project name" : mode.kind === "new-canvas" ? "New canvas name (e.g. Concept)" : "Name";
    return (
      <div className="project-switcher">
        {mode.kind !== "new-project" && project && <span className="crumb">{project.name} ›</span>}
        <input
          ref={input}
          className="project-name"
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
            if (e.key === "Escape") setMode({ kind: "idle" });
          }}
          onBlur={commit}
        />
        <button className="ghost" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          {mode.kind.startsWith("new") ? "Create" : "Save"}
        </button>
      </div>
    );
  }

  if (mode.kind === "delete-project" && project) {
    return (
      <div className="project-switcher">
        <button className="ghost danger" onClick={() => { setMode({ kind: "idle" }); onDeleteProject(project.id); }}>
          Delete project "{project.name}" and its {project.canvases.length} canvas{project.canvases.length === 1 ? "" : "es"}?
        </button>
        <button className="ghost" onClick={() => setMode({ kind: "idle" })}>Keep</button>
      </div>
    );
  }

  if (mode.kind === "delete-canvas" && current && canvas) {
    return (
      <div className="project-switcher">
        <button className="ghost danger" onClick={() => { setMode({ kind: "idle" }); onDeleteCanvas(current); }}>
          Delete canvas "{canvas.name}"?
        </button>
        <button className="ghost" onClick={() => setMode({ kind: "idle" })}>Keep</button>
      </div>
    );
  }

  return (
    <div className="project-switcher">
      <select
        className="project-select"
        value={current?.project ?? ""}
        title={current ? `data/projects/${current.project}/` : undefined}
        onChange={(e) => {
          const v = e.target.value;
          if (v === NEW) begin({ kind: "new-project" });
          else if (v === RENAME) begin({ kind: "rename-project" }, project?.name ?? "");
          else if (v === DELETE) setMode({ kind: "delete-project" });
          else {
            const p = projects.find((x) => x.id === v);
            if (p && p.canvases[0]) onSelect({ project: p.id, canvas: p.canvases[0].id });
          }
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
        <option disabled>──────</option>
        <option value={NEW}>+ New project…</option>
        {project && <option value={RENAME}>Rename project…</option>}
        {project && <option value={DELETE}>Delete project…</option>}
      </select>
      <span className="crumb">›</span>
      <select
        className="project-select canvas-select"
        value={current?.canvas ?? ""}
        title={current ? `data/projects/${current.project}/${current.canvas}.json` : undefined}
        disabled={!project}
        onChange={(e) => {
          const v = e.target.value;
          if (!project) return;
          if (v === NEW) begin({ kind: "new-canvas" });
          else if (v === RENAME) begin({ kind: "rename-canvas" }, canvas?.name ?? "");
          else if (v === DELETE) setMode({ kind: "delete-canvas" });
          else onSelect({ project: project.id, canvas: v });
        }}
      >
        {project?.canvases.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.nodeCount})
          </option>
        ))}
        <option disabled>──────</option>
        <option value={NEW}>+ New canvas…</option>
        {canvas && <option value={RENAME}>Rename canvas…</option>}
        {canvas && <option value={DELETE}>Delete canvas…</option>}
      </select>
    </div>
  );
}
