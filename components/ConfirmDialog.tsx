"use client";

import type { ComponentType } from "react";

type ConfirmDialogIcon = ComponentType<{ name: string; size?: number }>;

export type ConfirmDialogState = {
  title: string;
  text: string;
  danger?: boolean;
  confirmText?: string;
  action: () => void | Promise<void>;
};

export type ConfirmDialogProps = {
  state: ConfirmDialogState;
  Icon: ConfirmDialogIcon;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function ConfirmDialog({ state, Icon, onClose, onConfirm }: ConfirmDialogProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="confirm-dialog" onClick={(event) => event.stopPropagation()}>
        <div className={`dialog-icon ${state.danger ? "danger" : ""}`}>
          <Icon name={state.danger ? "trash" : "agent"} size={22} />
        </div>
        <h2>{state.title}</h2>
        <p>{state.text}</p>
        <div>
          <button className="secondary-action" onClick={onClose}>取消</button>
          <button className={state.danger ? "danger-action" : "primary-action compact"} onClick={onConfirm}>
            {state.confirmText || "确认"}
          </button>
        </div>
      </div>
    </div>
  );
}
