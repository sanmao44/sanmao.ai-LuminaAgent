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
  private readonly listeners = new Set<() => void>();
  private readonly maxHistory: number;

  constructor(document: TDocument, options: { maxHistory?: number } = {}) {
    this.current = document;
    this.maxHistory = Math.max(1, Math.floor(options.maxHistory ?? 60));
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  private reconcileSelection() {
    const nodeIds = new Set(this.current.nodes.map((node) => node.id));
    const groupIds = new Set(this.current.groups.map((group) => group.id));
    const edgeIds = new Set(this.current.edges.map((edge) => edge.id));
    const next = {
      nodeIds: this.selected.nodeIds.filter((id) => nodeIds.has(id)),
      ...(this.selected.groupId && groupIds.has(this.selected.groupId)
        ? { groupId: this.selected.groupId }
        : {}),
      ...(this.selected.edgeId && edgeIds.has(this.selected.edgeId)
        ? { edgeId: this.selected.edgeId }
        : {}),
    };
    const changed =
      next.nodeIds.length !== this.selected.nodeIds.length ||
      next.groupId !== this.selected.groupId ||
      next.edgeId !== this.selected.edgeId;
    this.selected = next;
    return changed;
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
    this.reconcileSelection();
    this.notify();
    return this.current;
  }

  replace(document: TDocument, options: { record?: boolean; clearHistory?: boolean; preserveHistory?: boolean } = {}) {
    if (options.record) this.pushPast(this.current);
    if (options.clearHistory) this.clearHistory();
    else if (!options.preserveHistory) this.future = [];
    this.current = document;
    this.reconcileSelection();
    this.notify();
    return this.current;
  }

  /** Record the current document as an undo boundary without changing it. */
  record() {
    this.pushPast(this.current);
    this.future = [];
    this.notify();
    return this.history();
  }

  setSelection(selection: CanvasCoreSelection) {
    const nodeIds = new Set(this.current.nodes.map((node) => node.id));
    const groupIds = new Set(this.current.groups.map((group) => group.id));
    const edgeIds = new Set(this.current.edges.map((edge) => edge.id));
    this.selected = {
      nodeIds: [...new Set(selection.nodeIds)].filter((id) => nodeIds.has(id)),
      ...(selection.groupId && groupIds.has(selection.groupId) ? { groupId: selection.groupId } : {}),
      ...(selection.edgeId && edgeIds.has(selection.edgeId) ? { edgeId: selection.edgeId } : {}),
    };
    this.notify();
    return this.selected;
  }

  setViewport(viewport: CanvasCoreViewport) {
    this.current = { ...this.current, camera: { ...viewport } };
    this.notify();
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
    this.reconcileSelection();
    this.notify();
    return { document: next, changed: true };
  }

  undo() {
    const previous = this.past.at(-1);
    if (!previous) return null;
    this.future = [...this.future, this.snapshotDocument(this.current)];
    this.past = this.past.slice(0, -1);
    this.current = previous;
    this.reconcileSelection();
    this.notify();
    return this.current;
  }

  redo() {
    const next = this.future.at(-1);
    if (!next) return null;
    this.past = [...this.past, this.current].slice(-this.maxHistory);
    this.future = this.future.slice(0, -1);
    this.current = next;
    this.reconcileSelection();
    this.notify();
    return this.current;
  }

  clearHistory() {
    this.past = [];
    this.future = [];
    this.notify();
  }

  private pushPast(document: TDocument) {
    // History entries are owned snapshots. This protects nested node data,
    // edges, and groups if a legacy adapter mutates a document in place after
    // the boundary was recorded.
    this.past = [...this.past, this.snapshotDocument(document)].slice(-this.maxHistory);
  }

  private snapshotDocument(document: TDocument) {
    return typeof structuredClone === "function"
      ? structuredClone(document)
      : JSON.parse(JSON.stringify(document)) as TDocument;
  }
}
