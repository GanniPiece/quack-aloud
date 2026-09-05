import { useEffect, useRef, useState } from "react";
import type { ProjectInfo } from "../api";

interface Props {
  projects: ProjectInfo[];
  current: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

const NEW = "__new__";

/**
 * Top-bar project picker. Creating and renaming use an inline text box (no browser dialogs,
 * which the embedded browser may block); deleting asks once, inline, and times out.
 */
export function ProjectSwitcher({ projects, current, onSelect, onCreate, onRename, onDelete }: Props) {
  const [mode, setMode] = useState<"idle" | "new" | "rename" | "delete">("idle");
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const currentProject = projects.find((p) => p.id === current);

  useEffect(() => {
    if (mode === "new" || mode === "rename") {
      const t = setTimeout(() => {
        input.current?.focus();
        input.current?.select();
      }, 20);
      return () => clearTimeout(t);
    }
    if (mode === "delete") {
      const t = setTimeout(() => setMode("idle"), 4000);
      return () => clearTimeout(t);
    }
  }, [mode]);

  const commit = () => {
    const name = text.trim();
    if (mode === "new") {
      if (name) onCreate(name);
    } else if (mode === "rename" && current) {
      if (name && name !== currentProject?.name) onRename(current, name);
    }
    setMode("idle");
  };

  if (mode === "new" || mode === "rename") {
    return (
      <div className="project-switcher">
        <input
          ref={input}
          className="project-name"
          value={text}
          placeholder={mode === "new" ? "New project name" : "Project name"}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) commit();
            if (e.key === "Escape") setMode("idle");
          }}
          onBlur={commit}
        />
        <button className="ghost" onMouseDown={(e) => e.preventDefault()} onClick={commit}>
          {mode === "new" ? "Create" : "Save"}
        </button>
      </div>
    );
  }

  return (
    <div className="project-switcher">
      <select
        className="project-select"
        value={current ?? ""}
        title={current ? `data/projects/${current}.json` : undefined}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setText("");
            setMode("new");
          } else {
            onSelect(e.target.value);
          }
        }}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.nodeCount})
          </option>
        ))}
        <option value={NEW}>+ New project…</option>
      </select>
      {current && mode !== "delete" && (
        <>
          <button
            className="ghost"
            title="Rename this project"
            onClick={() => {
              setText(currentProject?.name ?? "");
              setMode("rename");
            }}
          >
            Rename
          </button>
          <button className="ghost" title="Delete this project" onClick={() => setMode("delete")}>
            Delete
          </button>
        </>
      )}
      {current && mode === "delete" && (
        <>
          <button
            className="ghost danger"
            onClick={() => {
              setMode("idle");
              onDelete(current);
            }}
          >
            Delete "{currentProject?.name}"?
          </button>
          <button className="ghost" onClick={() => setMode("idle")}>
            Keep
          </button>
        </>
      )}
    </div>
  );
}
