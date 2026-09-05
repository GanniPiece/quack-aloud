import { memo, useEffect, useRef } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { KIND_LABEL, type NodeKind, type Origin } from "../../shared/graph";
import { DuckIcon } from "./DuckIcon";

export interface ThoughtData extends Record<string, unknown> {
  label: string;
  detail?: string;
  source?: string;
  origin: Origin;
  kind: NodeKind;
  fresh: boolean;
  /** Shown as a small tag when theme containers are not drawn */
  groupTitle?: string;
  tone?: number;
  /** Centre of the mind map */
  isRoot?: boolean;
  /** Inline label editing (new card, or double-clicked card) */
  editing?: boolean;
  onEditDone?: (label: string | null) => void;
}

export type ThoughtRFNode = Node<ThoughtData, "thought">;

function ThoughtNodeView({ data, selected }: NodeProps<ThoughtRFNode>) {
  const cls = [
    "thought",
    data.origin,
    data.kind,
    data.fresh ? "fresh" : "",
    selected ? "selected" : "",
    data.isRoot ? "root" : "",
    data.editing ? "editing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const done = useRef(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // React Flow focuses the pane on click, which would steal focus from a freshly mounted editor
  // A brand-new node is invisible until React Flow has measured it, and a hidden textarea
  // cannot take focus, so keep trying for a moment instead of focusing once.
  useEffect(() => {
    if (!data.editing) return;
    done.current = false;
    let tries = 0;
    const attempt = () => {
      const el = editRef.current;
      if (!el) return;
      el.focus();
      if (document.activeElement === el) {
        el.select();
        return;
      }
      if (tries++ < 20) timer = setTimeout(attempt, 40);
    };
    let timer = setTimeout(attempt, 20);
    return () => clearTimeout(timer);
  }, [data.editing]);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    data.onEditDone?.(value);
  };
  return (
    <div className={cls} title={data.editing ? undefined : data.source ? `From: "${data.source}"` : "Double-click to edit"}>
      {/* Four handles, all with ids: edges always say which side they use (see toRFEdges) */}
      <Handle type="target" position={Position.Left} id="tl" />
      <Handle type="source" position={Position.Left} id="sl" className="alt-handle" />
      <div className="thought-head">
        <span className="badge">
          {data.origin === "user" ? "You" : (
            <>
              <DuckIcon size={14} /> Duck
            </>
          )}
        </span>
        <span className="kind">{KIND_LABEL[data.kind]}</span>
      </div>
      {data.editing ? (
        <textarea
          ref={editRef}
          className="thought-edit nodrag nowheel nopan"
          rows={2}
          defaultValue={data.label === "New card" ? "" : data.label}
          placeholder="Type, then Enter"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              finish((e.target as HTMLTextAreaElement).value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              finish(null);
            }
          }}
          onBlur={(e) => finish(e.target.value)}
        />
      ) : (
        <div className="thought-label">{data.label}</div>
      )}
      {!data.editing && data.detail && <div className="thought-detail">{data.detail}</div>}
      {data.groupTitle && <div className={`group-tag tone-${(data.tone ?? 0) % 6}`}>{data.groupTitle}</div>}
      <Handle type="source" position={Position.Right} id="sr" />
      <Handle type="target" position={Position.Right} id="tr" className="alt-handle" />
    </div>
  );
}

export const ThoughtNode = memo(ThoughtNodeView);
