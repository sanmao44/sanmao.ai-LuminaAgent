# Canvas Core Assessment

## Current state

`lib/canvas/model.ts` already owns document normalization, snapshots and
domain helpers. `lib/canvas/patch.ts` validates and applies structured Agent
operations. `SuperCanvas` still owns React document projection, selection,
viewport updates and persistence adapters. History has completed its authority
cutover: `CanvasCore` now owns undo/redo history while React only projects it.

## Scope

This slice adds a React-free `CanvasCore` runtime with structural
`CanvasDocument`, `Selection`, `Viewport`, `Operation`, `Transaction` and
bounded `History` contracts. It is deliberately generic so it can operate on
the existing document without importing UI, storage or provider code.

The existing `commit` and Agent Canvas Patch path use the Core operation
boundary before handing the result to the legacy React state adapter. Existing
snapshot format, patch validation, local persistence and UI behavior remain
unchanged.

## Remaining legacy responsibility

Pointer gesture document mutations, full React selection rendering, project persistence
and the remaining document adapters still live in `SuperCanvas`. Document and
Selection authority remain migration in progress; history is cut over and no
second React history state machine remains.
