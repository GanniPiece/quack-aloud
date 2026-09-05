import { useCallback, useEffect, useState } from "react";
import { api, type HealthInfo } from "./api";
import { Canvas } from "./components/Canvas";
import { ChatPanel } from "./components/ChatPanel";
import { DuckIcon } from "./components/DuckIcon";
import { Timeline } from "./components/Timeline";
import { useGraph } from "./useGraph";

const FRESH_MS = 6000;
const GUIDE_KEY = "rubberduck.guide";
const CHAT_KEY = "rubberduck.chat";
const VIEW_KEY = "rubberduck.view";

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
  const [notice, setNotice] = useState<string | null>(null);
  const { graph, connected, update, adopt } = useGraph(setNotice);
  const [freshSince, setFreshSince] = useState<number>(Number.MAX_SAFE_INTEGER);
  const [guide, setGuide] = useState<boolean>(() => readSetting<"on" | "off">(GUIDE_KEY, "off") === "on");
  const [view, setView] = useState<View>(() => readSetting<View>(VIEW_KEY, "map"));
  const [chatOpen, setChatOpen] = useState<boolean>(() => readSetting<"open" | "closed">(CHAT_KEY, "open") === "open");

  const toggleChat = useCallback(() => {
    setChatOpen((open) => {
      writeSetting(CHAT_KEY, open ? "closed" : "open");
      return !open;
    });
  }, []);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

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

  const send = useCallback(
    async (text: string) => {
      setBusy(true);
      setError(null);
      const started = Date.now();
      try {
        const res = await api.think(text, guide);
        adopt(res.graph);
        setFreshSince(started);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [adopt, guide],
  );

  const reset = useCallback(() => {
    api.reset().then(adopt).catch((err) => setError((err as Error).message));
  }, [adopt]);

  const exportGraph = useCallback(() => {
    if (!graph) return;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rubber-duck-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Exported the canvas as a JSON file.");
  }, [graph]);

  const [pendingImport, setPendingImport] = useState<{ name: string; data: unknown } | null>(null);

  const runImport = useCallback(
    async (name: string, data: unknown) => {
      setPendingImport(null);
      try {
        adopt(await api.importGraph(data));
        setNotice(`Imported "${name}".`);
      } catch (err) {
        setNotice((err as Error).message);
      }
    },
    [adopt],
  );

  const importGraph = useCallback(
    async (file: File) => {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        setNotice(`"${file.name}" is not valid JSON.`);
        return;
      }
      const hasContent = (graph?.nodes.length ?? 0) > 0 || (graph?.messages.length ?? 0) > 0;
      if (hasContent) setPendingImport({ name: file.name, data });
      else void runImport(file.name, data);
    },
    [graph, runImport],
  );

  const disabledReason =
    health && !health.keyConfigured
      ? `No credentials for provider "${health.provider}". Chat is disabled, but you can still edit the canvas by hand or let Claude Code edit data/graph.json.`
      : null;

  return (
    <div className="app">
      <header className="topbar">
        <span className="title"><DuckIcon size={26} /> Rubber Duck</span>
        <span className="sub">Say it, see it, sort it out</span>
        <span className="spacer" />
        <button className="ghost" onClick={toggleChat} title={chatOpen ? "Hide the chat panel" : "Show the chat panel"}>
          {chatOpen ? "Hide chat" : "Show chat"}
        </button>
        <div className="segmented" role="tablist" aria-label="View">
          <button role="tab" aria-selected={view === "map"} className={view === "map" ? "on" : ""} onClick={() => changeView("map")}>Map</button>
          <button role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "on" : ""} onClick={() => changeView("timeline")}>Timeline</button>
        </div>
        {health && (
          <span className="pill" title={health.graphPath}>
            {health.provider} · {health.model}{health.effort ? ` · ${health.effort}` : ""}
          </span>
        )}
        <span className={`pill ${connected ? "ok" : "bad"}`}>{connected ? "live" : "disconnected"}</span>
      </header>
      <main className={`body ${chatOpen ? "" : "chat-closed"}`}>
        {chatOpen && (
          <ChatPanel
            messages={graph?.messages ?? []}
            busy={busy}
            error={error}
            disabledReason={disabledReason}
            guide={guide}
            onGuideChange={changeGuide}
            onCollapse={toggleChat}
            onSend={send}
          />
        )}
        <section className="canvas">
          {notice && <div className="notice">{notice}</div>}
          {pendingImport && (
            <div className="notice confirm-bar">
              Replace the current canvas with "{pendingImport.name}"? Export first if you want to keep it.
              <button className="danger" onClick={() => void runImport(pendingImport.name, pendingImport.data)}>Replace</button>
              <button onClick={() => setPendingImport(null)}>Cancel</button>
            </div>
          )}
          {!graph ? (
            <div className="loading">Loading canvas…</div>
          ) : view === "map" ? (
            <Canvas
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
