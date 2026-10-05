"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode, type RefObject } from "react";
import AgentOrb from "@/components/AgentOrb";
import { canvasVisibleStageWidth } from "@/lib/canvas/menu-layout";
import { groupBounds, nodeSize } from "@/lib/canvas/model";
import type { CanvasDocument, CanvasGroup, CanvasNode } from "@/lib/canvas/types";
import { placeCanvasGroupToolbar, placeCanvasNodeToolbar } from "@/lib/canvas/editor-layout";
import { nodeLabel } from "@/lib/canvas/menu-labels";
import { CanvasActionIcon, CanvasNodeQuickMenu, canvasPromptOrbState, type CanvasQuickAction, type CanvasQuickActionGroup, type CanvasQuickToolbarActions, type CanvasQuickToolbarTarget } from "@/components/canvas/CanvasContextMenu";
type CanvasQuickToolbarPosition = {
  left: number;
  top: number;
  placement?: "above" | "inside";
};

export default function CanvasQuickToolbar({
  target,
  document,
  stageRef,
  actions,
  menuSubtitle,
  actionRenderer,
}: {
  target: CanvasQuickToolbarTarget;
  document: CanvasDocument;
  stageRef: RefObject<HTMLDivElement | null>;
  actions: CanvasQuickToolbarActions;
  menuSubtitle: string;
  actionRenderer?: (action: CanvasQuickAction, button: ReactNode) => ReactNode;
}) {
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<CanvasQuickToolbarPosition>({ left: 10, top: 10 });
  const [isCompact, setIsCompact] = useState(false);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const targetId = target.kind === "node" ? target.node.id : target.group.id;

  const closeMenu = useCallback((returnFocus = false) => {
    const groupId = openGroupId;
    setOpenGroupId(null);
    if (returnFocus && groupId) {
      window.requestAnimationFrame(() => {
        toolbarRef.current
          ?.querySelector<HTMLButtonElement>(`[data-menu-trigger-id="${groupId}"]`)
          ?.focus();
      });
    }
  }, [openGroupId]);

  useEffect(() => {
    setOpenGroupId(null);
  }, [target.kind, targetId]);

  useEffect(() => {
    if (!openGroupId) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (toolbarRef.current?.contains(target) || target?.closest(".canvas-node-quick-menu")) return;
      setOpenGroupId(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    };
    window.document.addEventListener("pointerdown", closeOnOutsidePointer);
    window.document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutsidePointer);
      window.document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [closeMenu, openGroupId]);

  const reposition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const targetElement = Array.from(
      stage.querySelectorAll<HTMLElement>(
        target.kind === "node" ? "[data-canvas-node-id]" : "[data-canvas-group-id]",
      ),
    ).find((element) =>
      target.kind === "node"
        ? element.dataset.canvasNodeId === targetId
        : element.dataset.canvasGroupId === targetId,
    );
    const targetRect = targetElement?.getBoundingClientRect();
    const zoom = Math.max(0.12, document.camera.zoom || 1);
    const anchor = targetRect
      ? {
          left: targetRect.left - stageRect.left,
          top: targetRect.top - stageRect.top,
          width: targetRect.width,
          height: targetRect.height,
        }
      : target.kind === "node"
        ? {
            left: target.node.x * zoom + document.camera.x,
            top: target.node.y * zoom + document.camera.y,
            width: nodeSize(target.node).w * zoom,
            height: nodeSize(target.node).h * zoom,
          }
        : (() => {
            const bounds = groupBounds(document, target.group.id);
            return {
              left: bounds.x * zoom + document.camera.x,
              top: bounds.y * zoom + document.camera.y,
              width: bounds.w * zoom,
              height: bounds.h * zoom,
            };
          })();
    const stageSize = {
      width: Math.max(1, stage.clientWidth),
      height: Math.max(1, stage.clientHeight),
    };
    const compact = stageSize.width < 760 || zoom < 0.58;
    if (compact !== isCompact) setIsCompact(compact);
    const overlay = {
      width: toolbarRef.current?.offsetWidth || (compact ? 280 : 520),
      height: toolbarRef.current?.offsetHeight || 40,
    };
    /* 摆放用的宽度扣掉右侧 Agent 面板：工具栏宁可贴到面板左边，也别被压在面板下面。 */
    const placementStage = { ...stageSize, width: canvasVisibleStageWidth(stage) };
    const nextPosition: CanvasQuickToolbarPosition = target.kind === "group"
      ? placeCanvasGroupToolbar(anchor, placementStage, overlay, 10)
      : placeCanvasNodeToolbar(anchor, placementStage, overlay, 10);
    setPosition((current) =>
      current.left === nextPosition.left &&
      current.top === nextPosition.top &&
      current.placement === nextPosition.placement
        ? current
        : nextPosition,
    );
  }, [document, isCompact, stageRef, target, targetId]);

  const toggleGroup = useCallback((event: ReactMouseEvent<HTMLButtonElement>, group: CanvasQuickActionGroup) => {
    event.stopPropagation();
    if (openGroupId === group.id) {
      setOpenGroupId(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ x: rect.left - 10, y: rect.bottom - 10 });
    setOpenGroupId(group.id);
  }, [openGroupId]);

  const renderAction = (action: CanvasQuickAction) => {
    const button = (
      <button
        type="button"
        key={action.id}
        className={action.danger ? "danger" : ""}
        data-action-id={action.id}
        title={action.title || action.label}
        aria-label={action.label}
        disabled={action.disabled}
        onClick={(event) => {
          event.stopPropagation();
          closeMenu();
          action.onClick();
        }}
      >
        <span className="canvas-node-quick-icon" aria-hidden="true"><CanvasActionIcon name={action.icon} /></span>
        <em>{action.label}</em>
      </button>
    );
    return actionRenderer ? actionRenderer(action, button) : button;
  };

  const openGroup = actions.menuGroups.find((group) => group.id === openGroupId);

  useLayoutEffect(() => {
    reposition();
    let frame = 0;
    const handleResize = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };
    const observer = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(handleResize)
      : null;
    if (observer) {
      if (toolbarRef.current) observer.observe(toolbarRef.current);
      if (stageRef.current) observer.observe(stageRef.current);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [reposition, stageRef]);

  return (
    <>
      <div
        ref={toolbarRef}
        className="canvas-node-quick-toolbar"
        data-density={isCompact ? "compact" : "comfortable"}
        data-node-id={target.kind === "node" ? target.node.id : undefined}
        data-group-id={target.kind === "group" ? target.group.id : undefined}
        data-placement={position.placement}
        aria-label={`${target.kind === "node" ? nodeLabel(target.node) : `${target.group.name}对象组`}快捷工具`}
        style={{ left: position.left, top: position.top }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onWheel={(event) => event.stopPropagation()}
      >
        <span className="canvas-node-quick-title">
          <i aria-hidden="true">{target.kind === "node" && target.node.type === "prompt"
            ? <AgentOrb state={canvasPromptOrbState(target.node.data.status)} size={15} label="" />
            : target.kind === "group" ? "⌘" : target.node.type === "upscale" ? "↗" : target.node.type === "generator" ? "⌁" : target.node.data.kind === "video" ? "▶" : "▣"}</i>
          <span className="canvas-node-quick-title-copy">
            <b>{target.kind === "node" ? nodeLabel(target.node) : target.group.name}</b>
            {target.kind === "group" && <small>{target.group.nodeIds.length} 个对象</small>}
          </span>
        </span>
        <span className="canvas-node-quick-divider" aria-hidden="true" />
        <div className="canvas-node-quick-actions">
          {actions.primaryActions.map(renderAction)}
          {actions.menuGroups.filter((group) => group.actions.length > 0).map((group) => (
            <button
              type="button"
              key={group.id}
              className={`canvas-node-quick-menu-trigger${openGroupId === group.id ? " open" : ""}`}
              data-menu-trigger-id={group.id}
              title={group.title || group.label}
              aria-label={group.label}
              aria-haspopup="menu"
              aria-controls={`canvas-quick-menu-${targetId}-${group.id}`}
              aria-expanded={openGroupId === group.id}
              onClick={(event) => toggleGroup(event, group)}
            >
              <span className="canvas-node-quick-icon" aria-hidden="true"><CanvasActionIcon name={group.icon} /></span>
              <em>{group.label}</em>
              <span className="canvas-node-quick-caret" aria-hidden="true">⌄</span>
            </button>
          ))}
          {actions.dangerAction && renderAction(actions.dangerAction)}
        </div>
      </div>
      {openGroup && (
        <CanvasNodeQuickMenu
          targetId={targetId}
          group={openGroup}
          position={menuPosition}
          subtitle={menuSubtitle}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
