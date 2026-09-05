import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
} from "@xyflow/react";
import {
  GROUP_HEADER,
  GROUP_PAD,
  LAYOUT_LABEL,
  NODE_H,
  NODE_W,
  type Graph,
  type LayoutKind,
  type ThoughtNode as GraphNode,
} from "../../shared/graph";
import { applyLayout, effectiveLayout, layeredLayout, mindmapTree, mindmapTreeEdgeIds, type Sizes } from "../layout";
import { ClusterNode, type ClusterRFNode } from "./ClusterNode";
import { RoutedEdge, type RoutedRFEdge } from "./RoutedEdge";
import { ThoughtNode, type ThoughtRFNode } from "./ThoughtNode";
import { AxisNode, buildAxisNode, type AxisRFNode } from "./TimelineAxis";

const nodeTypes = { thought: ThoughtNode, cluster: ClusterNode, axis: AxisNode };
const edgeTypes = { routed: RoutedEdge };
const CLUSTER_PREFIX = "cluster:";
/** Background pseudo-nodes (theme containers, the time axis) are derived, never edited */
const isDerivedId = (id: string) => id.startsWith(CLUSTER_PREFIX) || id.startsWith("axis:");
const LAYOUTS: LayoutKind[] = ["themes", "layered", "timeline", "mindmap"];
const NEW_CARD_PLACEHOLDER = "New card";

type AnyNode = ThoughtRFNode | ClusterRFNode | AxisRFNode;

interface Props {
  graph: Graph;
  freshSince: number;
  /** Changes after every duck turn; triggers a re-layout when the layout is not "themes" */
  relayoutToken: number;
  update: (fn: (g: Graph) => Graph) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

interface Editing {
  id: string;
  /** A new card lives only in the browser until its label is committed */
  draft?: GraphNode;
}

/** Derive one background container per theme from the live card positions and measured sizes. */
function buildClusters(graph: Graph, cards: ThoughtRFNode[]): ClusterRFNode[] {
  const out: ClusterRFNode[] = [];
  graph.groups.forEach((g, i) => {
    const memberIds = new Set(graph.nodes.filter((n) => n.group === g.id).map((n) => n.id));
    const members = cards.filter((c) => memberIds.has(c.id));
    if (members.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      const w = m.measured?.width ?? NODE_W;
      const h = m.measured?.height ?? NODE_H;
      minX = Math.min(minX, m.position.x);
      minY = Math.min(minY, m.position.y);
      maxX = Math.max(maxX, m.position.x + w);
      maxY = Math.max(maxY, m.position.y + h);
    }
    const width = maxX - minX + GROUP_PAD * 2;
    const height = maxY - minY + GROUP_PAD + GROUP_HEADER;
    out.push({
      id: CLUSTER_PREFIX + g.id,
      type: "cluster",
      position: { x: minX - GROUP_PAD, y: minY - GROUP_HEADER },
      width,
      height,
      measured: { width, height },
      data: { title: g.title, width, height, tone: i, count: members.length },
      draggable: false,
      selectable: false,
      connectable: false,
      focusable: false,
      zIndex: -1,
    });
  });
  return out;
}

/** Same position, selection, measurement, and visible data (the edit callback is ignored). */
function sameCard(a: ThoughtRFNode, b: ThoughtRFNode): boolean {
  if (a.position.x !== b.position.x || a.position.y !== b.position.y) return false;
  if (!!a.selected !== !!b.selected) return false;
  if (a.measured?.width !== b.measured?.width || a.measured?.height !== b.measured?.height) return false;
  const { onEditDone: _a, ...da } = a.data;
  const { onEditDone: _b, ...db } = b.data;
  void _a;
  void _b;
  return JSON.stringify(da) === JSON.stringify(db);
}

interface NodeExtras {
  showTags: boolean;
  rootId?: string;
  editing?: Editing;
  onEditDone?: (label: string | null) => void;
}

function toRFNodes(graph: Graph, freshSince: number, x: NodeExtras): ThoughtRFNode[] {
  const groupIndex = new Map(graph.groups.map((g, i) => [g.id, i]));
  const nodes = x.editing?.draft ? [...graph.nodes, x.editing.draft] : graph.nodes;
  return nodes.map((n) => ({
    id: n.id,
    type: "thought",
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      detail: n.detail,
      source: n.source,
      origin: n.origin,
      kind: n.kind,
      fresh: n.createdAt >= freshSince,
      groupTitle: x.showTags && n.group ? graph.groups.find((g) => g.id === n.group)?.title : undefined,
      tone: n.group ? groupIndex.get(n.group) : undefined,
      isRoot: n.id === x.rootId,
      editing: x.editing?.id === n.id,
      onEditDone: x.editing?.id === n.id ? x.onEditDone : undefined,
    },
  }));
}

interface EdgeExtras {
  /** dagre way-points per edge id (Layered layout, while cards are where the layout put them) */
  routes?: Map<string, { x: number; y: number }[]>;
  /** edge ids that form the mind-map tree; other edges are drawn faint */
  treeEdges?: Set<string>;
}

/**
 * Edges leave from the side facing the target and arrive on the side facing the source, so a
 * link never loops around a card. Handles are always named: React Flow would otherwise pick the
 * first handle in DOM order, which is not necessarily the right-hand one.
 */
function toRFEdges(graph: Graph, extras: EdgeExtras = {}): (Edge | RoutedRFEdge)[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges.map((e) => {
    const s = byId.get(e.source), t = byId.get(e.target);
    const backwards = !!(s && t && t.x + NODE_W / 2 < s.x + NODE_W / 2);
    const route = extras.routes?.get(e.id);
    const cross = extras.treeEdges && !extras.treeEdges.has(e.id);
    const base = {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: backwards ? "sl" : "sr",
      targetHandle: backwards ? "tr" : "tl",
      label: e.label,
      className: `edge-${e.origin}${cross ? " edge-cross" : ""}`,
      animated: false,
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
    };
    return route ? { ...base, type: "routed" as const, data: { points: route } } : base;
  });
}

function CanvasInner({ graph, freshSince, relayoutToken, update, onReset, onExport, onImport }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { screenToFlowPosition, fitView, getInternalNode } = useReactFlow();
  const updateNodeInternals = useUpdateNodeInternals();
  const layout = effectiveLayout(graph);
  const showContainers = layout === "themes";
  const rootId = useMemo(() => (layout === "mindmap" ? mindmapTree(graph)?.rootId : undefined), [graph, layout]);
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [confirmClear, setConfirmClear] = useState(false);

  /** Commit or cancel an inline edit. A draft is only added to the graph when it gets a label. */
  const finishEdit = useCallback(
    (label: string | null) => {
      const cur = editing;
      setEditing(undefined);
      if (!cur) return;
      const text = label?.trim() ?? "";
      if (!text) return;
      if (cur.draft) {
        const node = { ...cur.draft, label: text };
        update((g) => ({ ...g, nodes: [...g.nodes, node] }));
      } else {
        update((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === cur.id ? { ...n, label: text } : n)) }));
      }
    },
    [editing, update],
  );

  // The "really clear?" state times out on its own
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 4000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const nodeExtras = useMemo<NodeExtras>(
    () => ({ showTags: !showContainers, rootId, editing, onEditDone: finishEdit }),
    [showContainers, rootId, editing, finishEdit],
  );

  const [rfNodes, setRfNodes] = useState<ThoughtRFNode[]>(() => toRFNodes(graph, freshSince, nodeExtras));
  const [rfEdges, setRfEdges] = useState<(Edge | RoutedRFEdge)[]>(() => toRFEdges(graph));
  const clusters = useMemo(() => (showContainers ? buildClusters(graph, rfNodes) : []), [graph, rfNodes, showContainers]);
  const axis = useMemo(() => (layout === "timeline" ? buildAxisNode(graph, rfNodes) : null), [graph, rfNodes, layout]);
  const allNodes = useMemo<AnyNode[]>(() => [...(axis ? [axis] : []), ...clusters, ...rfNodes], [axis, clusters, rfNodes]);

  // graph is the single source of truth; rebuild React Flow nodes on change but keep selection and measured
  // sizes, and keep the same object for cards that did not change (a new object makes React Flow drop
  // its measurement and re-measure the card).
  useEffect(() => {
    setRfNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return toRFNodes(graph, freshSince, nodeExtras).map((n) => {
        const old = prevById.get(n.id);
        if (!old) return n;
        const internal = getInternalNode(n.id)?.measured;
        const measured = old.measured?.width ? old.measured : internal?.width ? { width: internal.width!, height: internal.height! } : undefined;
        const next: ThoughtRFNode = { ...n, selected: old.selected, measured };
        return !n.data.editing && sameCard(old, next) ? old : next;
      });
    });
  }, [graph, freshSince, nodeExtras, getInternalNode]);

  // Safety net: a card added at runtime sometimes never gets measured (it stays invisible and
  // cannot take focus). Ask React Flow to measure whatever is still missing.
  useEffect(() => {
    const missing = rfNodes
      .filter((n) => {
        const m = getInternalNode(n.id)?.measured;
        return !m?.width || !m?.height;
      })
      .map((n) => n.id);
    if (missing.length === 0) return;
    const t = setTimeout(() => updateNodeInternals(missing), 50);
    return () => clearTimeout(t);
  }, [rfNodes, getInternalNode, updateNodeInternals]);

  // Bring nodes into view once they are measured, and again whenever the count changes
  const nodesInitialized = useNodesInitialized();
  const nodeCount = graph.nodes.length;
  useEffect(() => {
    if (nodeCount === 0 || !nodesInitialized || editing) return;
    const t = setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 30);
    return () => clearTimeout(t);
    // editing is read but deliberately not a dependency: a new card must not re-fit the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeCount, nodesInitialized, fitView]);

  const measuredSizes = useCallback((): Sizes => {
    return new Map(
      rfNodes
        .filter((n) => n.measured?.width && n.measured?.height)
        .map((n) => [n.id, { w: n.measured!.width!, h: n.measured!.height! }]),
    );
  }, [rfNodes]);

  // Edge decorations per layout: dagre routes (Layered) and tree/cross distinction (Mind map).
  // Routes are only trusted for edges whose two cards still sit where the layout put them.
  useEffect(() => {
    const extras: EdgeExtras = {};
    if (layout === "layered") {
      const sizes = measuredSizes();
      const { pos, routes } = layeredLayout(graph, (id) => sizes.get(id) ?? { w: NODE_W, h: NODE_H });
      const byId = new Map(graph.nodes.map((n) => [n.id, n]));
      const inPlace = (id: string) => {
        const n = byId.get(id), p = pos.get(id);
        return !!n && !!p && Math.abs(n.x - p.x) < 1.5 && Math.abs(n.y - p.y) < 1.5;
      };
      extras.routes = new Map(
        [...routes].filter(([eid]) => {
          const e = graph.edges.find((x) => x.id === eid);
          return e && inPlace(e.source) && inPlace(e.target);
        }),
      );
    } else if (layout === "mindmap") {
      extras.treeEdges = mindmapTreeEdgeIds(graph);
    }
    setRfEdges(toRFEdges(graph, extras));
  }, [graph, layout, measuredSizes]);

  const onNodesChange = useCallback(
    (changes: NodeChange<AnyNode>[]) => {
      // Background pseudo-nodes are derived; ignore whatever React Flow reports about them
      const cardChanges = changes.filter(
        (c) => !("id" in c && typeof c.id === "string" && isDerivedId(c.id)),
      ) as NodeChange<ThoughtRFNode>[];
      setRfNodes((nds) => applyNodeChanges(cardChanges, nds));
      const removed = cardChanges.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length) {
        update((g) => ({
          ...g,
          nodes: g.nodes.filter((n) => !removed.includes(n.id)),
          edges: g.edges.filter((e) => !removed.includes(e.source) && !removed.includes(e.target)),
        }));
      }
    },
    [update],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setRfEdges((eds) => applyEdgeChanges(changes, eds) as (Edge | RoutedRFEdge)[]);
      const removed = changes.filter((c) => c.type === "remove").map((c) => c.id);
      if (removed.length) {
        update((g) => ({ ...g, edges: g.edges.filter((e) => !removed.includes(e.id)) }));
      }
    },
    [update],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, __: AnyNode, dragged: AnyNode[]) => {
      const moved = new Map(dragged.map((n) => [n.id, n.position]));
      update((g) => ({
        ...g,
        nodes: g.nodes.map((n) => {
          const p = moved.get(n.id);
          return p ? { ...n, x: Math.round(p.x), y: Math.round(p.y) } : n;
        }),
      }));
    },
    [update],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      update((g) => {
        if (g.edges.some((e) => e.source === c.source && e.target === c.target)) return g;
        return {
          ...g,
          edges: [...g.edges, { id: `e-${c.source}-${c.target}`, source: c.source, target: c.target, origin: "user" }],
        };
      });
    },
    [update],
  );

  /** Double-click on empty canvas: drop a new card there and start typing its label. */
  const onPaneDoubleClick = useCallback(
    (ev: React.MouseEvent) => {
      const target = ev.target as HTMLElement;
      if (target.closest(".react-flow__node-thought, .react-flow__edge, .react-flow__panel, .react-flow__controls")) return;
      const pos = screenToFlowPosition({ x: ev.clientX, y: ev.clientY });
      const id = `u-${Date.now().toString(36)}`;
      const draft: GraphNode = {
        id,
        label: NEW_CARD_PLACEHOLDER,
        origin: "user",
        kind: "idea",
        x: Math.round(pos.x - NODE_W / 2),
        y: Math.round(pos.y - 40),
        createdAt: Date.now(),
      };
      setEditing({ id, draft });
    },
    [screenToFlowPosition],
  );

  const onNodeDoubleClick: NodeMouseHandler<AnyNode> = useCallback((_, node) => {
    if (node.type !== "thought") return;
    setEditing({ id: node.id });
  }, []);

  const doLayout = useCallback(
    (kind?: LayoutKind) => {
      const sizes = measuredSizes();
      update((g) => applyLayout(g, kind ?? effectiveLayout(g), sizes));
    },
    [update, measuredSizes],
  );

  const chooseLayout = useCallback(
    (value: string) => {
      const kind = value === "auto" ? undefined : (value as LayoutKind);
      const sizes = measuredSizes();
      update((g) => {
        const next = { ...g, layout: kind };
        return applyLayout(next, effectiveLayout(next), sizes);
      });
    },
    [update, measuredSizes],
  );

  // After a duck turn the server places cards in theme columns; re-arrange once the new cards are measured
  const appliedToken = useRef(relayoutToken);
  useEffect(() => {
    if (relayoutToken === appliedToken.current || !nodesInitialized || layout === "themes") return;
    appliedToken.current = relayoutToken;
    const t = setTimeout(() => doLayout(layout), 0);
    return () => clearTimeout(t);
  }, [relayoutToken, nodesInitialized, layout, doLayout]);

  const counts = useMemo(() => {
    const user = graph.nodes.filter((n) => n.origin === "user").length;
    return { user, ai: graph.nodes.length - user };
  }, [graph.nodes]);

  return (
    <ReactFlow
      nodes={allNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={onConnect}
      onNodeDoubleClick={onNodeDoubleClick}
      onDoubleClick={onPaneDoubleClick}
      zoomOnDoubleClick={false}
      zoomOnScroll
      zoomOnPinch
      panOnScroll={false}
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      panOnDrag={[1, 2]}
      panActivationKeyCode="Space"
      deleteKeyCode={editing ? null : ["Backspace", "Delete"]}
      fitView
      minZoom={0.1}
      maxZoom={2.5}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable nodeColor={(n) => ((n.data as { origin?: string }).origin === "user" ? "#f2c94c" : "#9db4d6")} />
      <Panel position="top-left" className="legend">
        <span className="swatch user" /> Yours {counts.user}
        <span className="swatch ai" /> Duck's {counts.ai}
        <span className="swatch group" /> Themes {graph.groups.filter((g) => graph.nodes.some((n) => n.group === g.id)).length}
        <span className="hint">Scroll to zoom · Space+drag or middle-drag to pan · drag on empty space to select · double-click empty space to add a card · Delete to remove</span>
      </Panel>
      <Panel position="top-right" className="toolbar">
        <label className="layout-pick">
          Layout
          <select value={graph.layout ?? "auto"} onChange={(e) => chooseLayout(e.target.value)}>
            <option value="auto">Auto ({LAYOUT_LABEL[graph.suggestedLayout ?? "themes"]})</option>
            {LAYOUTS.map((k) => (
              <option key={k} value={k}>{LAYOUT_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <button onClick={() => doLayout()} disabled={graph.nodes.length === 0}>Tidy</button>
        <span className="toolbar-sep" />
        <button onClick={onExport} disabled={graph.nodes.length === 0 && graph.messages.length === 0}>Export</button>
        <button onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImport(f);
            e.target.value = "";
          }}
        />
        {confirmClear ? (
          <>
            <button
              className="danger confirm"
              onClick={() => {
                setConfirmClear(false);
                onReset();
              }}
            >
              Really clear everything?
            </button>
            <button onClick={() => setConfirmClear(false)}>Keep</button>
          </>
        ) : (
          <button
            className="danger"
            disabled={graph.nodes.length === 0 && graph.messages.length === 0}
            onClick={() => setConfirmClear(true)}
          >
            Clear
          </button>
        )}
      </Panel>
    </ReactFlow>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
