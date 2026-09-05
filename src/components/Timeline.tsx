import { useMemo } from "react";
import { KIND_LABEL, type Graph, type ThoughtNode } from "../../shared/graph";
import { DuckIcon } from "./DuckIcon";

interface Props {
  graph: Graph;
}

interface Entry {
  ts: number;
  /** What the user said in this turn; undefined for cards added by hand on the canvas */
  message?: string;
  nodes: ThoughtNode[];
}

/**
 * Groups cards by the turn that created them. applyThinkResult stamps a turn's user
 * message and its new nodes with the same timestamp, so `createdAt === message.ts`
 * identifies the turn. Anything else (hand-added cards, imported files) gets its own entry.
 */
function buildEntries(graph: Graph): Entry[] {
  const byTs = new Map<number, Entry>();
  for (const m of graph.messages) {
    if (m.role === "user") byTs.set(m.ts, { ts: m.ts, message: m.content, nodes: [] });
  }
  for (const n of graph.nodes) {
    const entry = byTs.get(n.createdAt);
    if (entry) entry.nodes.push(n);
    else byTs.set(n.createdAt, { ts: n.createdAt, nodes: [n] });
  }
  return [...byTs.values()].sort((a, b) => a.ts - b.ts);
}

function formatTime(ts: number): string {
  if (ts < 1e12) return "";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function Timeline({ graph }: Props) {
  const entries = useMemo(() => buildEntries(graph), [graph]);
  const groupTitle = useMemo(() => new Map(graph.groups.map((g) => [g.id, g.title])), [graph.groups]);

  if (entries.length === 0) {
    return <div className="timeline-empty">Nothing here yet. Cards appear in the order you say them.</div>;
  }

  return (
    <div className="timeline">
      {entries.map((e) => (
        <section className="tl-entry" key={e.ts}>
          <div className="tl-rail">
            <span className="tl-dot" />
          </div>
          <div className="tl-body">
            <div className="tl-meta">
              {e.message ? <span className="tl-quote">{e.message}</span> : <span className="tl-quote muted">Added on the canvas</span>}
              <span className="tl-time">{formatTime(e.ts)}</span>
            </div>
            {e.nodes.length === 0 && <div className="tl-none">No new cards</div>}
            <div className="tl-cards">
              {e.nodes.map((n) => (
                <div key={n.id} className={`thought tl-card ${n.origin} ${n.kind}`}>
                  <div className="thought-head">
                    <span className="badge">
                      {n.origin === "user" ? "You" : (
                        <>
                          <DuckIcon size={14} /> Duck
                        </>
                      )}
                    </span>
                    <span className="kind">{KIND_LABEL[n.kind]}</span>
                  </div>
                  <div className="thought-label">{n.label}</div>
                  {n.detail && <div className="thought-detail">{n.detail}</div>}
                  {n.source && <div className="thought-source">{n.source}</div>}
                  {n.group && groupTitle.has(n.group) && <div className="thought-group">{groupTitle.get(n.group)}</div>}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
