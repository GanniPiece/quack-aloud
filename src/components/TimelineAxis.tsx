import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { NODE_H, NODE_W, type Graph } from "../../shared/graph";
import { TIMELINE_LANE_LABEL, timelineLane, timelineSpine } from "../layout";
import type { ThoughtRFNode } from "./ThoughtNode";

type LaneKey = "-1" | "0" | "1" | "2";

export interface AxisData extends Record<string, unknown> {
  width: number;
  height: number;
  axisY: number;
  ticks: { x: number; label: string }[];
  lanes: { key: LaneKey; top: number; bottom: number }[];
  padX: number;
}

export type AxisRFNode = Node<AxisData, "axis">;

const PAD_X = 150; // room on the left for lane labels
const PAD_Y = 24;
export const AXIS_ID = "axis:timeline";

/**
 * Builds one background pseudo-node carrying the numbered time axis and the swim-lane bands.
 * Geometry comes from where the cards actually are, so it stays right after a drag.
 */
export function buildAxisNode(graph: Graph, cards: ThoughtRFNode[]): AxisRFNode | null {
  if (cards.length === 0) return null;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const box = (id: string) => {
    const c = byId.get(id);
    if (!c) return null;
    const w = c.measured?.width ?? NODE_W;
    const h = c.measured?.height ?? NODE_H;
    return { x: c.position.x, y: c.position.y, w, h, cx: c.position.x + w / 2, cy: c.position.y + h / 2 };
  };
  const spine = timelineSpine(graph)
    .map((n, i) => ({ n, i, b: box(n.id) }))
    .filter((s) => s.b) as { n: Graph["nodes"][number]; i: number; b: NonNullable<ReturnType<typeof box>> }[];
  if (spine.length === 0) return null;

  const axisYAbs = spine.reduce((s, x) => s + x.b.cy, 0) / spine.length;

  const spineIds = new Set(spine.map((s) => s.n.id));
  const laneBoxes: Partial<Record<LaneKey, { top: number; bottom: number }>> = {};
  const add = (key: LaneKey, b: { y: number; h: number }) => {
    const cur = laneBoxes[key];
    laneBoxes[key] = cur
      ? { top: Math.min(cur.top, b.y), bottom: Math.max(cur.bottom, b.y + b.h) }
      : { top: b.y, bottom: b.y + b.h };
  };
  for (const s of spine) add("0", s.b);
  for (const n of graph.nodes) {
    if (spineIds.has(n.id)) continue;
    const b = box(n.id);
    if (b) add(String(timelineLane(n)) as LaneKey, b);
  }
  const lanesAbs = (["-1", "0", "1", "2"] as LaneKey[])
    .filter((k) => laneBoxes[k])
    .map((k) => ({ key: k, top: laneBoxes[k]!.top - PAD_Y, bottom: laneBoxes[k]!.bottom + PAD_Y }));

  const all = cards.map((c) => box(c.id)!);
  const minX = Math.min(...all.map((b) => b.x)) - PAD_X;
  const maxX = Math.max(...all.map((b) => b.x + b.w)) + 60;
  const minY = Math.min(...lanesAbs.map((l) => l.top)) - 8;
  const maxY = Math.max(...lanesAbs.map((l) => l.bottom)) + 8;
  const width = maxX - minX;
  const height = maxY - minY;

  return {
    id: AXIS_ID,
    type: "axis",
    position: { x: minX, y: minY },
    width,
    height,
    measured: { width, height },
    data: {
      width,
      height,
      padX: PAD_X,
      axisY: axisYAbs - minY,
      ticks: spine.map(({ n, i, b }) => ({ x: b.cx - minX, label: String(n.seq ?? i + 1) })),
      lanes: lanesAbs.map((l) => ({ key: l.key, top: l.top - minY, bottom: l.bottom - minY })),
    },
    draggable: false,
    selectable: false,
    connectable: false,
    focusable: false,
    zIndex: -2,
  };
}

function AxisNodeView({ data }: NodeProps<AxisRFNode>) {
  const { width: W, height: H, axisY, ticks, lanes, padX } = data;
  const numberY = axisY + NODE_H / 2 + 26;
  return (
    <div className="tl-axis" style={{ width: W, height: H }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {lanes.map((l) => (
          <g key={l.key}>
            <rect className={`tl-lane lane-${l.key === "-1" ? "m1" : l.key}`} x={0} y={l.top} width={W} height={l.bottom - l.top} rx={12} />
            <text className="tl-lane-label" x={14} y={l.top + 20}>
              {TIMELINE_LANE_LABEL[l.key]}
            </text>
          </g>
        ))}
        <line className="tl-axis-line" x1={padX - 50} y1={axisY} x2={W - 26} y2={axisY} />
        <polygon className="tl-axis-arrow" points={`${W - 26},${axisY - 6} ${W - 10},${axisY} ${W - 26},${axisY + 6}`} />
        {ticks.map((t) => (
          <g key={t.label + t.x} className="tl-tick">
            <line x1={t.x} y1={axisY - 8} x2={t.x} y2={axisY + 8} />
            <circle cx={t.x} cy={numberY} r={11} />
            <text x={t.x} y={numberY + 4} textAnchor="middle">
              {t.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export const AxisNode = memo(AxisNodeView);
