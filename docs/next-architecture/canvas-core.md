# Canvas Core Authority Migration

> Historical implementation record. Current ownership, remaining compatibility
> layers and machine-enforced rules are defined by `ARCHITECTURE.md` and
> `docs/next-architecture/migration-status.md`; where this file and those differ,
> the authoritative documents win.

## Current result

CanvasCore is framework independent and now owns the three Canvas domain authorities:

- Document: `document()` is the only authoritative document snapshot.
- History: `past` / `future` own commit, undo, redo and bounded immutable snapshots.
- Selection: `selection()` owns node, group and edge selection and prunes references invalidated by document mutations.

`SuperCanvas` uses `useSyncExternalStore` as a projection/consumer. UI-only state such as hover, pointer interaction, menus, drafts and animation remains in React.

## Unified mutation path

User commands, Agent Canvas Patch, restore/load and background reconciliation call `CanvasCore.apply` or `CanvasCore.replace`. React no longer owns a separately writable document or selection state machine.

## Remaining legacy responsibility

`SuperCanvas` still owns rendering, pointer/gesture implementation, persistence adapters, task polling, provider/media calls, progress and UI-local state. These are intentionally outside this slice.

## Migration adapter

The temporary `setDoc`, `replaceDoc`, and selection setter functions are Core action adapters for legacy call sites. They do not own state. They can be deleted after call sites use explicit Canvas commands and persistence moves behind a port.
