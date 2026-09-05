import { BaseEdge, EdgeLabelRenderer, type Edge, type EdgeProps } from "@xyflow/react";

type Pt = { x: number; y: number };

export interface RoutedData extends Record<string, unknown> {
  /** Way-points between source and target, in flow coordinates */
  points: Pt[];
}

export type RoutedRFEdge = Edge<RoutedData, "routed">;

/** Smooth curve through the points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/** Point half-way along the polyline, for the label. */
function midpoint(pts: Pt[]): Pt {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((a, b) => a + b, 0);
  let left = total / 2;
  for (let i = 0; i < seg.length; i++) {
    if (left <= seg[i]) {
      const t = seg[i] ? left / seg[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    left -= seg[i];
  }
  return pts[pts.length - 1];
}

/**
 * An edge that follows dagre's routing (around intermediate cards) instead of a straight Bézier.
 * Used by the Layered layout while the cards still sit where the layout put them.
 */
export function RoutedEdge({ id, sourceX, sourceY, targetX, targetY, data, label, markerEnd, style }: EdgeProps<RoutedRFEdge>) {
  const inner = data?.points?.slice(1, -1) ?? [];
  const pts: Pt[] = [{ x: sourceX, y: sourceY }, ...inner, { x: targetX, y: targetY }];
  const mid = midpoint(pts);
  return (
    <>
      <BaseEdge id={id} path={smoothPath(pts)} markerEnd={markerEnd} style={style} />
      {label && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ transform: `translate(-50%, -50%) translate(${mid.x}px, ${mid.y}px)` }}>
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
