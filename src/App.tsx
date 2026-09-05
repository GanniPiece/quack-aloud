import { useCallback, useEffect, useRef, useState } from "react";
import { api, type HealthInfo } from "./api";
import { Canvas } from "./components/Canvas";
import { ChatPanel, type PendingMessage } from "./components/ChatPanel";
import { DuckIcon } from "./components/DuckIcon";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { Timeline } from "./components/Timeline";
import { useGraph } from "./useGraph";

const FRESH_MS = 6000;
const GUIDE_KEY = "rubberduck.guide";
const CHAT_KEY = "rubberduck.chat";
const VIEW_KEY = "rubberduck.view";
const PROJECT_KEY = "rubberduck.project";

type View = "map" | "timeline";

function readSetting<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode etc. */
  }
}

export default function App() {
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages waiting for the duck: the first is in flight, the rest are queued
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [restore, setRestore] = useState<{ key: number; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(() => readSetting(PROJECT_KEY, "") || null);
  const { graph, projects, connected, update, adopt } = useGraph(project, setNotice);
  const [freshSince, setFreshSince] = useState<number>(Number.MAX_SAFE_INTEGER);
  const [guide, setGuide] = useState<boolean>(() => readSetting<"on" | "off">(GUIDE_KEY, "off") === "on");
  const [view, setView] = useState<View>(() => readSetting<View>(VIEW_KEY, "map"));
  const [chatOpen, setChatOpen] = useState<boolean>(() => readSetting<"open" | "closed">(CHAT_KEY, "open") === "open");

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const selectProject = useCallback((id: string | null) => {
    setProject(id);
    writeSetting(PROJECT_KEY, id ?? "");
    setError(null);
  }, []);

  // Keep the selection valid against the live project list: fall back to the newest project.
  // Never create projects from here: the server guarantees at least one exists, and a reactive
  // "create when empty" once produced a dozen duplicates in a single second.
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    if (project && projects.some((p) => p.id === project)) return;
    selectProject(projects[0].id);
  }, [projects, project, selectProject]);

  // Notices (e.g. "canvas changed elsewhere") fade on their own
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice]);

  // Highlight freshly added nodes for a few seconds
  useEffect(() => {
    if (freshSince === Number.MAX_SAFE_INTEGER) return;
    const t = setTimeout(() => setFreshSince(Number.MAX_SAFE_INTEGER), FRESH_MS);
    return () => clearTimeout(t);
  }, [freshSince]);

  const changeGuide = useCallback((on: boolean) => {
    setGuide(on);
    writeSetting(GUIDE_KEY, on ? "on" : "off");
  }, []);

  const changeView = useCallback((v: View) => {
    setView(v);
    writeSetting(VIEW_KEY, v);
  }, []);

  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      writeSetting(CHAT_KEY, open ? "closed" : "open");
      return !open;
    });
  }, []);

  /** Enqueue; the effect below sends one message at a time, in order. */
  const send = useCallback((text: string) => {
    setError(null);
    setPending((q) => [...q, { id: Date.now() + Math.random(), text, status: q.length === 0 ? "sending" : "queued" }]);
  }, []);

  // One request in flight at a time. Gated by a ref, not by `busy`, so the effect never
  // cancels its own request when it flips the busy flag.
  const inFlight = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    if (inFlight.current || pending.length === 0 || !project) return;
    const head = pending[0];
    inFlight.current = true;
    setBusy(true);
    setPending((q) => q.map((p, i) => ({ ...p, status: i === 0 ? "sending" : "queued" })));
    const started = Date.now();
    api
      .think(project, head.text, guide)
      .then((res) => {
        if (projectRef.current === project) {
          adopt(res.graph);
          setFreshSince(started);
        }
        setPending((q) => q.filter((p) => p.id !== head.id));
      })
      .catch((err) => {
        // Nothing is lost: the failed message and everything queued behind it go back into the box
        setError((err as Error).message);
        setPending((q) => {
          setRestore({ key: Date.now(), text: q.map((p) => p.text).join("\n") });
          return [];
        });
      })
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  }, [pending, project, guide, adopt]);

  const reset = useCallback(() => {
    if (!project) return;
    api.reset(project).then(adopt).catch((err) => setError((err as Error).message));
  }, [adopt, project]);

  // ---------- projects ----------

  const createProject = useCallback(
    (name: string) => {
      api
        .createProject(name)
        .then(({ id }) => {
          selectProject(id);
          setNotice(`Created "${name}".`);
        })
        .catch((err) => setNotice((err as Error).message));
    },
    [selectProject],
  );

  const renameProject = useCallback(
    (id: string, name: string) => {
      api
        .renameProject(id, name)
        .then(({ graph: g }) => {
          if (id === project) adopt(g);
        })
        .catch((err) => setNotice((err as Error).message));
    },
    [adopt, project],
  );

  const deleteProject = useCallback(
    (id: string) => {
      api
        .deleteProject(id)
        .then(({ replacement }) => {
          if (id === project) selectProject(replacement);
          setNotice("Project moved to data/trash.");
        })
        .catch((err) => setNotice((err as Error).message));
    },
    [project, selectProject],
  );

  // ---------- export / import (one project = one file) ----------

  const exportGraph = useCallback(() => {
    if (!graph) return;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const slug = (graph.name ?? "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rubber-duck-${slug}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported "${graph.name ?? "project"}" as a JSON file.`);
  }, [graph]);

  const importGraph = useCallback(
    async (file: File) => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        setNotice(`"${file.name}" is not valid JSON.`);
        return;
      }
      const fallbackName = file.name.replace(/\.json$/i, "").replace(/^rubber-duck-/, "").replace(/-\d{8}-\d{4}$/, "") || "Imported project";
      const name = (data as { name?: unknown })?.name;
      try {
        const { id, graph: g } = await api.importGraph(typeof name === "string" && name ? name : fallbackName, data);
        selectProject(id);
        setNotice(`Imported "${g.name}" as a new project.`);
      } catch (err) {
        setNotice((err as Error).message);
      }
    },
    [selectProject],
  );

  const disabledReason =
    health && !health.keyConfigured
      ? `No credentials for provider "${health.provider}". Chat is disabled, but you can still edit the canvas by hand or let Claude Code edit the project file.`
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="title"><DuckIcon size={26} /> Rubber Duck</span>
        <ProjectSwitcher
          projects={projects ?? []}
          current={project}
          onSelect={selectProject}
          onCreate={createProject}
          onRename={renameProject}
          onDelete={deleteProject}
        />
        <span className="spacer" />
        <button className="ghost" onClick={toggleChat} title={chatOpen ? "Hide the chat panel" : "Show the chat panel"}>
          {chatOpen ? "Hide chat" : "Show chat"}
        </button>
        <div className="segmented" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => changeView("map")}>Map</button>
          <button role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "on" : ""} onClick={() => changeView("timeline")}>Timeline</button>
        </div>
        {health && (
          <span className="pill" title={health.projectsDir}>
            {health.provider} · {health.model}{health.effort ? ` · ${health.effort}` : ""}
          </span>
        )}
        <span className={`pill ${connected ? "ok" : "bad"}`}>{connected ? "live" : "disconnected"}</span>
      </header>
      <main className={`body ${chatOpen ? "" : "chat-closed"}`}>
        {chatOpen && (
          <ChatPanel
            messages={graph?.messages ?? []}
            pending={pending}
            busy={busy}
            error={error}
            disabledReason={disabledReason}
            guide={guide}
            restore={restore}
            onGuideChange={changeGuide}
            onCollapse={toggleChat}
            onSend={send}
          />
        )}
        <section className="canvas">
          {notice && <div className="notice">{notice}</div>}
          {!graph ? (
            <div className="loading">
              {projects && projects.length === 0 ? (
                <button className="ghost" onClick={() => createProject("My project")}>Create a project</button>
              ) : (
                "Loading project…"
              )}
            </div>
          ) : view === "map" ? (
            <Canvas
              key={project ?? "none"}
              graph={graph}
              freshSince={freshSince}
              relayoutToken={freshSince}
              update={update}
              onReset={reset}
              onExport={exportGraph}
              onImport={importGraph}
            />
          ) : (
            <Timeline graph={graph} />
          )}
        </section>
      </main>
    </div>
  );
}
