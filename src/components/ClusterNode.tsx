import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface ClusterData extends Record<string, unknown> {
  title: string;
  width: number;
  height: number;
  /** Palette index, cycles through a few soft tints */
  tone: number;
  count: number;
}

export type ClusterRFNode = Node<ClusterData, "cluster">;

function ClusterNodeView({ data }: NodeProps<ClusterRFNode>) {
  return (
    <div className={`cluster tone-${data.tone % 6}`} style={{ width: data.width, height: data.height }}>
      <div className="cluster-title">
        {data.title}
        <span className="cluster-count">{data.count}</span>
      </div>
    </div>
  );
}

export const ClusterNode = memo(ClusterNodeView);
