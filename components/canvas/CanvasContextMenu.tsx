"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import { type AgentOrbState } from "@/components/AgentOrb";
import CanvasActionIcon from "@/components/canvas/CanvasActionIcon";
import { groupBounds, nodeSize } from "@/lib/canvas/model";
import type { CanvasDocument, CanvasGroup, CanvasNode } from "@/lib/canvas/types";
import { placeCanvasContextMenu } from "@/lib/canvas/editor-layout";
import { nodeLabel } from "@/lib/canvas/menu-labels";
export {
  appendCanvasAgentAction,
  createCanvasAgentAction,
  projectCanvasGroupContextMenuGroups,
  prependCanvasAgentContextMenuGroup,
  type CanvasContextMenuGroup,
  type CanvasQuickAction,
  type CanvasQuickActionGroup,
  type CanvasQuickToolbarActions,
} from "@/lib/canvas/menu-actions";
import type {
  CanvasContextMenuGroup,
  CanvasQuickAction,
  CanvasQuickActionGroup,
  CanvasQuickToolbarActions,
} from "@/lib/canvas/menu-actions";

export type CanvasQuickToolbarTarget =
  | { kind: "node"; node: CanvasNode }
  | { kind: "group"; group: CanvasGroup };

/** Agent 文本节点的光球状态：排队与生成中＝思考中，失败＝错误色，其余＝空闲。 */
export function canvasPromptOrbState(status: string | undefined): AgentOrbState {
  if (status === "failed") return "error";
  if (status === "queued" || status === "running") return "thinking";
  return "idle";
}

export { default as CanvasActionIcon } from "@/components/canvas/CanvasActionIcon";

export function CanvasNodeQuickMenu({
  targetId,
  group,
  position,
  subtitle,
  onClose,
}: {
  targetId: string;
  group: CanvasQuickActionGroup;
  position: { x: number; y: number };
  subtitle: string;
  onClose: (returnFocus?: boolean) => void;
}) {
  const firstEnabledAction = group.actions.find((action) => !action.disabled);
  const menuId = `canvas-quick-menu-${targetId}-${group.id}`;
  const firstActionRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    let attempts = 0;
    let frame = 0;
    const focusFirstAction = () => {
      const action = firstActionRef.current;
      if (!action) return;
      action.focus();
      if (window.document.activeElement !== action && attempts < 3) {
        attempts += 1;
        frame = window.requestAnimationFrame(focusFirstAction);
      }
    };
    frame = window.requestAnimationFrame(focusFirstAction);
    return () => window.cancelAnimationFrame(frame);
  }, [firstEnabledAction?.id]);
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        ".canvas-node-quick-menu-item:not(:disabled)",
      ),
    );
    if (event.key === "Escape") {
      event.preventDefault();
      onClose(true);
      return;
    }
    if (!items.length || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = items.indexOf(window.document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (currentIndex + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  return (
    <CanvasContextMenuFrame
      className="canvas-node-quick-menu"
      dataNodeId={targetId}
      dataMenuId={menuId}
      ariaLabel={`${group.label}菜单`}
      position={position}
    >
      <div className="canvas-node-quick-menu-body" onKeyDown={handleKeyDown}>
        <div className="canvas-menu-title">
          <span>{group.label}</span>
          <small>{subtitle}</small>
        </div>
        {group.actions.map((action) => (
          <button
            type="button"
            role="menuitem"
            key={action.id}
            className={`canvas-menu-item canvas-node-quick-menu-item${action.danger ? " danger" : ""}`}
            title={action.title || action.label}
            aria-label={action.label}
            disabled={action.disabled}
            ref={action === firstEnabledAction ? firstActionRef : undefined}
            autoFocus={action === firstEnabledAction}
            onClick={(event) => {
              event.stopPropagation();
              onClose();
              action.onClick();
            }}
          >
            <span className="canvas-menu-icon" aria-hidden="true"><CanvasActionIcon name={action.icon} /></span>
            <span className="canvas-menu-copy"><b>{action.label}</b></span>
            <span className="canvas-menu-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </CanvasContextMenuFrame>
  );
}
export function CanvasContextMenuFrame({
  position,
  className,
  ariaLabel,
  dataNodeId,
  dataMenuId,
  children,
}: {
  position: { x: number; y: number };
  className?: string;
  ariaLabel: string;
  dataNodeId?: string;
  dataMenuId?: string;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState({
    left: position.x + 10,
    top: position.y + 10,
  });
  const [measured, setMeasured] = useState(false);

  const reposition = useCallback(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const viewport = {
      width: Math.max(1, window.visualViewport?.width || window.innerWidth),
      height: Math.max(1, window.visualViewport?.height || window.innerHeight),
    };
    const next = placeCanvasContextMenu(
      { left: position.x, top: position.y },
      viewport,
      { width: rect.width, height: rect.height },
    );
    setPlacement((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
    setMeasured(true);
  }, [position.x, position.y]);

  useLayoutEffect(() => {
    setMeasured(false);
    reposition();
    let frame = 0;
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reposition();
      });
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(schedule)
      : null;
    if (observer && menuRef.current) observer.observe(menuRef.current);
    window.addEventListener("resize", schedule);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener("resize", schedule);
    visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      visualViewport?.removeEventListener("resize", schedule);
      visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [reposition]);

  const menu = (
    <div
      ref={menuRef}
      className={`canvas-context-menu${className ? ` ${className}` : ""}`}
      data-node-id={dataNodeId}
      data-menu-id={dataMenuId}
      role="menu"
      aria-label={ariaLabel}
      style={{
        left: placement.left,
        top: placement.top,
        visibility: measured ? "visible" : "hidden",
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
  // Keep the menu inside the canvas React tree. This is still a fixed,
  // screen-space layer, but avoids losing synthetic events when the Next.js
  // app is mounted directly on body and the menu is portaled to body.
  return menu;
}

export function CanvasNodeContextMenu({
  node,
  selectionCount,
  groups,
  position,
}: {
  node: CanvasNode;
  selectionCount: number;
  groups: CanvasContextMenuGroup[];
  position: { x: number; y: number };
}) {
  return (
    <CanvasContextMenuFrame
      className="canvas-node-context-menu"
      dataNodeId={node.id}
      ariaLabel={`${nodeLabel(node)}右键菜单`}
      position={position}
    >
      <div className="canvas-menu-title">
        <span>{nodeLabel(node)}</span>
        <small>{selectionCount > 1 ? `已选择 ${selectionCount} 个对象` : "节点操作"}</small>
      </div>
      <div className="canvas-context-menu-body">
        {groups.filter((group) => group.actions.length > 0).map((group) => (
          <div className="canvas-menu-group" key={group.label}>
            {group.actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                key={action.id}
                className={`canvas-menu-item canvas-menu-item-context ${action.danger ? "danger" : ""}`}
                title={action.title || action.label}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true"><CanvasActionIcon name={action.icon} /></span>
                <span className="canvas-menu-copy"><b>{action.label}</b></span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </CanvasContextMenuFrame>
  );
}

export function CanvasGroupContextMenu({
  group,
  groups,
  position,
}: {
  group: CanvasGroup;
  groups: CanvasContextMenuGroup[];
  position: { x: number; y: number };
}) {
  return (
    <CanvasContextMenuFrame
      className="canvas-group-context-menu"
      dataMenuId={group.id}
      ariaLabel={`${group.name}对象组右键菜单`}
      position={position}
    >
      <div className="canvas-menu-title">
        <span>{group.name}</span>
        <small>{group.nodeIds.length} 个对象 · 组操作</small>
      </div>
      <div className="canvas-context-menu-body">
        {groups.map((menuGroup) => (
          <div className="canvas-menu-group" key={menuGroup.label}>
            {menuGroup.actions.map((action) => (
              <button
                type="button"
                role="menuitem"
                key={action.id}
                className={`canvas-menu-item canvas-menu-item-context${action.danger ? " danger" : ""}`}
                title={action.title || action.label}
                aria-label={action.label}
                disabled={action.disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  action.onClick();
                }}
              >
                <span className="canvas-menu-icon" aria-hidden="true">
                  <CanvasActionIcon name={action.icon} />
                </span>
                <span className="canvas-menu-copy"><b>{action.label}</b></span>
                <span className="canvas-menu-arrow" aria-hidden="true">›</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </CanvasContextMenuFrame>
  );
}
