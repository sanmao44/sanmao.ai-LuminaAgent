/**
 * React-free Canvas Core runtime.
 *
 * The document shape is intentionally structural so the core can operate on
 * the existing canvas domain without importing React, Next.js or storage.
 */

export type CanvasCoreNode = { id: string };
export type CanvasCoreEdge = { id: string; source: string; target: string };
export type CanvasCoreGroup = { id: string; nodeIds: readonly string[] };
export type CanvasCoreViewport = { x: number; y: number; zoom: number };

export type CanvasCoreDocument = {
  version: string;
  nodes: readonly CanvasCoreNode[];
  edges: readonly CanvasCoreEdge[];
  groups: readonly CanvasCoreGroup[];
  camera: CanvasCoreViewport;
};

export type CanvasCoreSelection = {
  nodeIds: readonly string[];
  groupId?: string;
  edgeId?: string;
};

export type CanvasCoreOperation<TDocument extends CanvasCoreDocument> = {
  id: string;
  label: string;
  apply(document: TDocument): TDocument;
};

export type CanvasCoreTransaction<TDocument extends CanvasCoreDocument> = {
  id: string;
  label: string;
  operations: readonly CanvasCoreOperation<TDocument>[];
};

export type CanvasCoreHistory<TDocument extends CanvasCoreDocument> = {
  past: readonly TDocument[];
  future: readonly TDocument[];
};

export type CanvasCoreApplyResult<TDocument extends CanvasCoreDocument> = {
  document: TDocument;
  changed: boolean;
};

function emptySelection(): CanvasCoreSelection {
  return { nodeIds: [] };
}

/** Small in-memory transaction and history runtime for Canvas domain state. */
export class CanvasCore<TDocument extends CanvasCoreDocument> {
  private current: TDocument;
  private selected: CanvasCoreSelection = emptySelection();
  private past: TDocument[] = [];
  private future: TDocument[] = [];
  private readonly maxHistory: number;

  constructor(document: TDocument, options: { maxHistory?: number } = {}) {
    this.current = document;
    this.maxHistory = Math.max(1, Math.floor(options.maxHistory ?? 60));
  }

  document() {
    return this.current;
  }

  selection() {
    return this.selected;
  }

  viewport() {
    return this.current.camera;
  }

  history(): CanvasCoreHistory<TDocument> {
    return { past: this.past, future: this.future };
  }

  /** Synchronize with a legacy adapter update without creating a second history entry. */
  sync(document: TDocument) {
    this.current = document;
    return this.current;
  }

  replace(document: TDocument, options: { record?: boolean } = {}) {
    if (options.record) this.pushPast(this.current);
    else this.future = [];
    this.current = document;
    return this.current;
  }

  setSelection(selection: CanvasCoreSelection) {
    this.selected = {
      nodeIds: [...new Set(selection.nodeIds)],
      ...(selection.groupId ? { groupId: selection.groupId } : {}),
      ...(selection.edgeId ? { edgeId: selection.edgeId } : {}),
    };
    return this.selected;
  }

  setViewport(viewport: CanvasCoreViewport) {
    this.current = { ...this.current, camera: { ...viewport } };
    return this.current.camera;
  }

  apply(operation: CanvasCoreOperation<TDocument>): CanvasCoreApplyResult<TDocument>;
  apply(transaction: CanvasCoreTransaction<TDocument>): CanvasCoreApplyResult<TDocument>;
  apply(input: CanvasCoreOperation<TDocument> | CanvasCoreTransaction<TDocument>): CanvasCoreApplyResult<TDocument> {
    const operations = 'operations' in input ? input.operations : [input];
    const next = operations.reduce((document, operation) => operation.apply(document), this.current);
    if (next === this.current) return { document: this.current, changed: false };
    this.pushPast(this.current);
    this.current = next;
    this.future = [];
    return { document: next, changed: true };
  }

  undo() {
    const previous = this.past.at(-1);
    if (!previous) return null;
    this.future = [...this.future, this.current];
    this.past = this.past.slice(0, -1);
    this.current = previous;
    return this.current;
  }

  redo() {
    const next = this.future.at(-1);
    if (!next) return null;
    this.past = [...this.past, this.current].slice(-this.maxHistory);
    this.future = this.future.slice(0, -1);
    this.current = next;
    return this.current;
  }

  clearHistory() {
    this.past = [];
    this.future = [];
  }

  private pushPast(document: TDocument) {
    this.past = [...this.past, document].slice(-this.maxHistory);
  }
}
