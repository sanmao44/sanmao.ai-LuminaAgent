# Page / UI Cleanup Assessment

## Current state

`app/page.tsx` still owns navigation state, workspace data loading, feature
state and almost every section renderer. Its root shell also defines the
shared `<main>` class contract inline, which makes composition changes depend
on the page implementation.

## Scope

This slice extracts `WorkspaceShell`, a React composition boundary for the
existing root shell. It preserves the current `app-shell`, angle, video and
sidebar-open class behavior and passes all existing page children through
unchanged.

## Non-goals

Agent, history, provider, model and canvas sections remain in `page.tsx`.
Their state, data loading, event handlers and rendered behavior are not moved
until each section has a smaller behavior-tested boundary.

## Real path

`Page` now renders its existing root content through `WorkspaceShell`. The
component has no storage, provider or feature dependencies; it only owns the
shared shell element and its stable class mapping.

The main content column is also represented by `MainColumn`, which preserves
the existing `main-column` layout class while keeping the page's feature
sections as children.

`WorkspaceTopbar` now owns the shared brand, mode navigation, Canvas entry and
theme toggle markup. It receives navigation and theme callbacks as props, so
it does not depend on feature state, storage or provider modules.

`SidebarBrandHeader` now owns the sidebar toggle and brand entry chrome. Chat
history, feature navigation and management controls remain page-owned because
they still carry section-specific state and actions.

`SidebarNavigation` now owns the creation and management navigation markup. It
receives section state and navigation callbacks; chat history and footer status
actions remain outside this boundary.

`SidebarFooterActions` now owns the responsive model status and support entry
points. Model counts and support actions are passed in from the page root.

`SidebarChatHistory` now owns the assistant history presentation, including
search, persona filtering, rename controls and selection controls. Session
state and repository operations remain page-owned and arrive through callbacks.

`AgentContextDock` now owns the Agent memory, persona, skill, MCP and
conversation-share controls. It receives snapshots and callbacks from the
page, while persistence and share orchestration remain outside the component.

`AgentWelcome` now owns the empty Agent conversation state and example prompt
buttons. The page still owns the input state and receives selected examples
through a callback.

`AgentMessageSelectionBar` now owns the message batch-selection toolbar. The
page supplies the selected count and mutation callbacks.

`AgentFollowUpCard` now owns the quoted-message preview shown above the Agent
composer. The active follow-up value and clear action remain page-owned.

`AgentIntentClarifyCard` now owns the compact delivery-choice prompt for
ambiguous Agent requests. Intent classification and dispatch remain page-owned.

## Remaining legacy responsibility

`app/page.tsx` remains the legacy composition root. The sidebar, section
renderers and feature state are still inline and are candidates for later
vertical slices.
