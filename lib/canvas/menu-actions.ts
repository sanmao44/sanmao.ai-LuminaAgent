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

export function projectCanvasGroupContextMenuGroups(
  actions: CanvasQuickToolbarActions,
  options: {
    onCopy: () => void;
    onArrange: () => void;
    closeAction: (action: () => void) => () => void;
  },
): CanvasContextMenuGroup[] {
  const primary = actions.primaryActions.map((action) => ({
    ...action,
    onClick: options.closeAction(
      action.id === "arrange-group" ? options.onArrange : action.onClick,
    ),
  }));
  const groupOperations = actions.menuGroups.find((group) => group.id === "group-actions");
  const layer = actions.menuGroups.find((group) => group.id === "layer");
  const wrapActions = (items: CanvasQuickAction[]) =>
    items.map((action) => ({ ...action, onClick: options.closeAction(action.onClick) }));

  return [
    {
      label: "组操作",
      actions: [
        {
          id: "copy-group",
          icon: "copy",
          label: "复制组内容",
          title: "复制组到剪贴板",
          onClick: options.closeAction(options.onCopy),
        },
        ...primary,
        ...wrapActions(groupOperations?.actions || []),
      ],
    },
    { label: "层级", actions: wrapActions(layer?.actions || []) },
    {
      label: "删除",
      actions: actions.dangerAction
        ? [{ ...actions.dangerAction, onClick: options.closeAction(actions.dangerAction.onClick) }]
        : [],
    },
  ].filter((group) => group.actions.length > 0);
}
