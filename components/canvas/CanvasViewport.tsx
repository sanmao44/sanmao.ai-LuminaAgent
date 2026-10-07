"use client";

import type {
  DragEventHandler,
  ForwardedRef,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
  WheelEventHandler,
} from "react";
import { forwardRef } from "react";
import type { CanvasCamera } from "@/lib/canvas/types";

export type CanvasViewportProps = {
  className: string;
  cursorTask: string;
  onPointerDown: PointerEventHandler<HTMLDivElement>;
  onPointerDownCapture: PointerEventHandler<HTMLDivElement>;
  onPointerMove: PointerEventHandler<HTMLDivElement>;
  onPointerUp: PointerEventHandler<HTMLDivElement>;
  onPointerCancel: PointerEventHandler<HTMLDivElement>;
  onLostPointerCapture: PointerEventHandler<HTMLDivElement>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
  onDragStart: DragEventHandler<HTMLDivElement>;
  onDragOver: DragEventHandler<HTMLDivElement>;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDrop: DragEventHandler<HTMLDivElement>;
  onContextMenu: MouseEventHandler<HTMLDivElement>;
  onWheel: WheelEventHandler<HTMLDivElement>;
  children: ReactNode;
};

/**
 * Owns the canvas stage DOM contract and event forwarding.
 *
 * Pointer state, document mutations, and viewport commands remain in
 * CanvasWorkspace. This component only provides the stable viewport surface
 * that those callbacks act on.
 */
const CanvasViewport = forwardRef<HTMLDivElement, CanvasViewportProps>(function CanvasViewport({
  className,
  cursorTask,
  onPointerDown,
  onPointerDownCapture,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onDoubleClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
  onWheel,
  children,
}: CanvasViewportProps, ref: ForwardedRef<HTMLDivElement>) {
  return (
    <div
      ref={ref}
      className={className}
      data-canvas-cursor-task={cursorTask}
      tabIndex={-1}
      aria-keyshortcuts="Delete"
      onPointerDown={onPointerDown}
      onPointerDownCapture={onPointerDownCapture}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
    >
      {children}
    </div>
  );
});

CanvasViewport.displayName = "CanvasViewport";

export default CanvasViewport;

export type CanvasWorldProps = {
  camera: CanvasCamera;
  zoomTier: "overview" | "detail";
  children: ReactNode;
};

/** Owns the camera transform wrapper without owning camera state. */
export function CanvasWorld({ camera, zoomTier, children }: CanvasWorldProps) {
  return (
    <div className="canvas-world">
      <div
        className="canvas-world-content"
        data-zoom-tier={zoomTier}
        style={{
          transform: `translate3d(${camera.x}px,${camera.y}px,0) scale(${camera.zoom})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
