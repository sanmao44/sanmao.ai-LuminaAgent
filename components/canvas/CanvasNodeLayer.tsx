"use client";

import { Fragment, type ReactElement } from "react";
import type { CanvasNode } from "@/lib/canvas/types";

export type CanvasNodeLayerProps = {
  nodes: readonly CanvasNode[];
  renderNode: (node: CanvasNode) => ReactElement;
};

/**
 * Owns the node layer container and stable list keys.
 *
 * Node state, mutations, and card behavior remain owned by CanvasWorkspace;
 * this component only establishes the presentation boundary for the list.
 */
export default function CanvasNodeLayer({
  nodes,
  renderNode,
}: CanvasNodeLayerProps) {
  return (
    <div className="canvas-node-layer">
      {nodes.map((node) => (
        <Fragment key={node.id}>{renderNode(node)}</Fragment>
      ))}
    </div>
  );
}
