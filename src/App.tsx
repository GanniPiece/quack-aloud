import { useCallback, useEffect, useRef, useState } from "react";
import { api, type AuthUser, type CanvasRef, type HealthInfo } from "./api";
import { Canvas } from "./components/Canvas";
import { ChatPanel, type PendingMessage } from "./components/ChatPanel";
import { DuckIcon } from "./components/DuckIcon";
import { ProjectSwitcher } from "./components/ProjectSwitcher";
import { SettingsDialog } from "./components/SettingsDialog";
import { Timeline } from "./components/Timeline";
import { useGraph } from "./useGraph";

const FRESH_MS = 6000;
const GUIDE_KEY = "quackaloud.guide";
const CHAT_KEY = "quackaloud.chat";
const VIEW_KEY = "quackaloud.view";
const CANVAS_KEY = "quackaloud.canvas"; // "<project>/<canvas>"
const LEGACY_PROJECT_KEY = "quackaloud.project";

function readCanvasRef(): CanvasRef | null {
  const v = readSetting(CANVAS_KEY, "");
  const [project, canvas] = v.split("/");
  if (project && canvas) return { project, canvas };
  const legacy = readSetting(LEGACY_PROJECT_KEY, "");
  return legacy ? { project: legacy, canvas: "" } : null;
}

type View = "map" | "timeline";

function readSetting<T extends string>(key: string, fallback: T): T {
  try {
    // settings written under the pre-release name are still honoured
    const legacy = localStorage.getItem(key.replace(/^quackaloud\./, "rubberduck."));
    return (localStorage.getItem(key) as T | null) ?? (legacy as T | null) ?? fallback;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [me, setMe] = useState<AuthUser | null>(null);
  useEffect(() => {
    api
      .authStatus()
      .then((s) => {
        setAuthRequired(s.authRequired);
        setMe(s.user);
      })
      .catch(() => undefined);
  }, []);
  const refreshHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Messages waiting for the duck: the first is in flight, the rest are queued
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [restore, setRestore] = useState<{ key: number; text: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sel, setSel] = useState<CanvasRef | null>(readCanvasRef);
  const ref = sel && sel.canvas ? sel : null; // a ref without a canvas is only a hint for the effect below
  const { graph, projects, connected, update, adopt } = useGraph(ref, setNotice);
  const [freshSince, setFreshSince] = useState<number>(Number.MAX_SAFE_INTEGER);
  const [guide, setGuide] = useState<boolean>(() => readSetting<"on" | "off">(GUIDE_KEY, "off") === "on");
  const [view, setView] = useState<View>(() => readSetting<View>(VIEW_KEY, "map"));
  const [chatOpen, setChatOpen] = useState<boolean>(() => readSetting<"open" | "closed">(CHAT_KEY, "open") === "open");

  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  const selectCanvas = useCallback((next: CanvasRef | null) => {
    setSel(next);
    writeSetting(CANVAS_KEY, next ? `${next.project}/${next.canvas}` : "");
    setError(null);
  }, []);

  // Keep the selection valid against the live project tree: an unknown project falls back to
  // the newest one, an unknown canvas to the project's newest canvas. Never create anything
  // from here: the server guarantees every project has a canvas, and a reactive "create when
  // empty" once produced a dozen duplicates in a single second.
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    const project = projects.find((p) => p.id === sel?.project) ?? projects[0];
    if (project.canvases.length === 0) return;
    const canvas = project.canvases.find((c) => c.id === sel?.canvas) ?? project.canvases[0];
    if (sel?.project !== project.id || sel?.canvas !== canvas.id) selectCanvas({ project: project.id, canvas: canvas.id });
  }, [projects, sel, selectCanvas]);

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
  const refKey = ref ? `${ref.project}/${ref.canvas}` : "";

  // One request in flight at a time. Gated by a ref, not by `busy`, so the effect never
  // cancels its own request when it flips the busy flag.
  const inFlight = useRef(false);
  const refKeyRef = useRef(refKey);
  refKeyRef.current = refKey;
  useEffect(() => {
    if (inFlight.current || pending.length === 0 || !ref) return;
    const head = pending[0];
    const target = ref;
    const targetKey = refKey;
    inFlight.current = true;
    setBusy(true);
    setPending((q) => q.map((p, i) => ({ ...p, status: i === 0 ? "sending" : "queued" })));
    const started = Date.now();
    api
      .think(target, head.text, guide)
      .then((res) => {
        if (refKeyRef.current === targetKey) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, refKey, guide, adopt]);

  const reset = useCallback(() => {
    if (!ref) return;
    api.reset(ref).then(adopt).catch((err) => setError((err as Error).message));
  }, [adopt, ref]);

  // ---------- projects and canvases ----------

  const fail = useCallback((err: unknown) => setNotice((err as Error).message), []);

  const createProject = useCallback(
    (name: string) => {
      api
        .createProject(name)
        .then(({ id, canvas }) => {
          selectCanvas({ project: id, canvas });
          setNotice(`Created project "${name}".`);
        })
        .catch(fail);
    },
    [selectCanvas, fail],
  );

  const renameProject = useCallback((id: string, name: string) => api.renameProject(id, name).catch(fail), [fail]);

  const deleteProject = useCallback(
    (id: string) => {
      api
        .deleteProject(id)
        .then(({ replacement }) => {
          if (id === sel?.project) selectCanvas(replacement ? { project: replacement, canvas: "" } : null);
          setNotice("Project moved to data/trash.");
        })
        .catch(fail);
    },
    [sel, selectCanvas, fail],
  );

  const createCanvas = useCallback(
    (project: string, name: string) => {
      api
        .createCanvas(project, name)
        .then(({ id }) => {
          selectCanvas({ project, canvas: id });
          setNotice(`Created canvas "${name}".`);
        })
        .catch(fail);
    },
    [selectCanvas, fail],
  );

  const renameCanvas = useCallback(
    (target: CanvasRef, name: string) => {
      api
        .renameCanvas(target, name)
        .then(({ graph: g }) => {
          if (target.project === ref?.project && target.canvas === ref?.canvas) adopt(g);
        })
        .catch(fail);
    },
    [adopt, ref, fail],
  );

  const deleteCanvas = useCallback(
    (target: CanvasRef) => {
      api
        .deleteCanvas(target)
        .then(({ replacement }) => {
          if (target.project === sel?.project && target.canvas === sel?.canvas) {
            selectCanvas({ project: target.project, canvas: replacement ?? "" });
          }
          setNotice("Canvas moved to data/trash.");
        })
        .catch(fail);
    },
    [sel, selectCanvas, fail],
  );

  // ---------- export / import (one project = one file) ----------

  const exportGraph = useCallback(() => {
    if (!graph) return;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const projectName = projects?.find((p) => p.id === ref?.project)?.name ?? "project";
    const slug = `${projectName}-${graph.name ?? "canvas"}`.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "") || "canvas";
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `quack-aloud-${slug}-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`Exported "${graph.name ?? "canvas"}" as a JSON file.`);
  }, [graph, projects, ref]);

  const importGraph = useCallback(
    async (file: File) => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        setNotice(`"${file.name}" is not valid JSON.`);
        return;
      }
      const fallbackName = file.name.replace(/\.json$/i, "").replace(/^(quack-aloud|rubber-duck)-/, "").replace(/-\d{8}-\d{4}$/, "") || "Imported canvas";
      const name = (data as { name?: unknown })?.name;
      if (!ref) return;
      try {
        const { id, graph: g } = await api.importGraph(ref.project, typeof name === "string" && name ? name : fallbackName, data);
        selectCanvas({ project: ref.project, canvas: id });
        setNotice(`Imported "${g.name}" as a new canvas in this project.`);
      } catch (err) {
        setNotice((err as Error).message);
      }
    },
    [ref, selectCanvas],
  );

  const disabledReason =
    health && !health.keyConfigured
      ? `No API key for provider "${health.provider}". Add one in Settings (top right). Until then you can still edit the canvas by hand or let Claude Code edit the project file.`
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="title"><DuckIcon size={26} /> Quack Aloud</span>
        <ProjectSwitcher
          projects={projects ?? []}
          current={ref}
          onSelect={selectCanvas}
          onCreateProject={createProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          onCreateCanvas={createCanvas}
          onRenameCanvas={renameCanvas}
          onDeleteCanvas={deleteCanvas}
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
          <button className="pill as-button" title="Settings: provider, API key, model, effort" onClick={() => setSettingsOpen(true)}>
            {health.provider} · {health.model}{health.effort ? ` · ${health.effort}` : ""}{health.keyConfigured ? "" : " · no key"}
          </button>
        )}
        <button className="ghost" onClick={() => setSettingsOpen(true)} title="Provider, API key, model, effort, password">
          Settings
        </button>
        {authRequired && me && (
          <button
            className="ghost"
            title={`Signed in as ${me.email} (${me.role}). Click to sign out.`}
            onClick={() => api.authLogout().then(() => window.dispatchEvent(new Event("qa:unauthorized"))).catch(fail)}
          >
            {me.email} · Sign out
          </button>
        )}
        <span className={`pill ${connected ? "ok" : "bad"}`}>{connected ? "live" : "disconnected"}</span>
      </header>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onSaved={refreshHealth} me={me} />}
      <main className={`body ${chatOpen ? "" : "chat-closed"}`}>
        {chatOpen && (
          <ChatPanel
            messages={graph?.messages ?? []}
            pending={pending}
            busy={busy}
            error={error}
            disabledReason={disabledReason}
            onOpenSettings={() => setSettingsOpen(true)}
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
                "Loading canvas…"
              )}
            </div>
          ) : view === "map" ? (
            <Canvas
              key={refKey || "none"}
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
