export type CanvasQuickAction = {
  id: string;
  icon: string;
  label: string;
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
};

export type CanvasQuickActionGroup = {
  id: string;
  icon: string;
  label: string;
  title?: string;
  actions: CanvasQuickAction[];
};

export type CanvasQuickToolbarActions = {
  primaryActions: CanvasQuickAction[];
  menuGroups: CanvasQuickActionGroup[];
  dangerAction?: CanvasQuickAction;
};

export type CanvasContextMenuGroup = {
  label: string;
  actions: CanvasQuickAction[];
};

export function createCanvasAgentAction(
  onClick: () => void,
  title: string,
): CanvasQuickAction {
  return {
    id: "ask-agent",
    icon: "agent",
    label: "问 Agent",
    title,
    onClick,
  };
}

export function appendCanvasAgentAction(
  actions: CanvasQuickToolbarActions,
  onClick: () => void,
  title: string,
): CanvasQuickToolbarActions {
  return {
    ...actions,
    primaryActions: [
      ...actions.primaryActions,
      createCanvasAgentAction(onClick, title),
    ],
  };
}

export function prependCanvasAgentContextMenuGroup(
  groups: CanvasContextMenuGroup[],
  onClick: () => void,
  title: string,
): CanvasContextMenuGroup[] {
  return [
    {
      label: "Agent",
      actions: [createCanvasAgentAction(onClick, title)],
    },
    ...groups,
  ];
}
