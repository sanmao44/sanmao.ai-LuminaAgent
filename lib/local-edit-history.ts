import { normalizeLocalEditAnnotations, type LocalEditAnnotation } from './local-edit';

export type LocalEditHistorySnapshot = {
  baseMask: ImageData;
  annotations: LocalEditAnnotation[];
  protectedPixels: Uint8Array;
  smartMasks: ReadonlyMap<string, Uint8ClampedArray>;
};

export type LocalEditHistorySnapshotInput = {
  baseMask: ImageData;
  annotations: readonly LocalEditAnnotation[];
  protectedPixels: Uint8Array;
  smartMasks: ReadonlyMap<string, Uint8ClampedArray>;
};

export const LOCAL_EDIT_HISTORY_LIMIT = 21;

type LocalEditKeyboardEvent = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat'>;

type LocalEditKeyboardTarget = EventTarget & {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
};

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export function isLocalEditTextEditingTarget(target: EventTarget | null) {
  if (!target) return false;
  const element = target as LocalEditKeyboardTarget;
  if (element.isContentEditable) return true;

  const tagName = element.tagName?.toLowerCase();
  const role = element.getAttribute?.('role')?.toLowerCase();
  if (tagName === 'textarea' || tagName === 'select' || role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton') {
    return true;
  }
  if (tagName !== 'input') return false;

  const type = (element.type || element.getAttribute?.('type') || 'text').toLowerCase();
  return !NON_TEXT_INPUT_TYPES.has(type);
}

export function resolveLocalEditHistoryShortcut(
  event: LocalEditKeyboardEvent,
  target: EventTarget | null,
): 'undo' | 'redo' | null {
  if (event.repeat || (!event.ctrlKey && !event.metaKey) || isLocalEditTextEditingTarget(target)) return null;

  const key = event.key.toLowerCase();
  if (key === 'z' || event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo';
  if (key === 'y' || event.code === 'KeyY') return 'redo';
  return null;
}

export function createLocalEditHistorySnapshot(
  input: LocalEditHistorySnapshotInput,
): LocalEditHistorySnapshot {
  return {
    baseMask: input.baseMask,
    annotations: normalizeLocalEditAnnotations(input.annotations),
    protectedPixels: input.protectedPixels,
    smartMasks: new Map(input.smartMasks),
  };
}

export function sameLocalEditHistorySnapshot(
  left: LocalEditHistorySnapshot,
  right: LocalEditHistorySnapshot,
) {
  if (left.baseMask !== right.baseMask || left.protectedPixels !== right.protectedPixels) return false;
  if (JSON.stringify(left.annotations) !== JSON.stringify(right.annotations)) return false;
  if (left.smartMasks.size !== right.smartMasks.size) return false;
  for (const [id, pixels] of left.smartMasks) {
    if (right.smartMasks.get(id) !== pixels) return false;
  }
  return true;
}

/** Keeps immutable raster buffers shared; callers replace buffers when they change them. */
export class LocalEditHistory {
  private snapshots: LocalEditHistorySnapshot[] = [];
  private cursor = -1;

  get index() {
    return this.cursor;
  }

  get length() {
    return this.snapshots.length;
  }

  at(index: number) {
    return this.snapshots[index] || null;
  }

  reset(initial?: LocalEditHistorySnapshot | null) {
    this.snapshots = initial ? [createLocalEditHistorySnapshot(initial)] : [];
    this.cursor = initial ? 0 : -1;
  }

  push(next: LocalEditHistorySnapshot, previous?: LocalEditHistorySnapshot | null) {
    const snapshot = createLocalEditHistorySnapshot(next);
    const current = previous || this.at(this.cursor);
    if (current && sameLocalEditHistorySnapshot(current, snapshot)) return false;

    const snapshots = this.snapshots.slice(0, this.cursor + 1);
    snapshots.push(snapshot);
    while (snapshots.length > LOCAL_EDIT_HISTORY_LIMIT) snapshots.shift();
    this.snapshots = snapshots;
    this.cursor = snapshots.length - 1;
    return true;
  }

  moveTo(index: number) {
    const snapshot = this.at(index);
    if (!snapshot) return null;
    this.cursor = index;
    return snapshot;
  }
}
