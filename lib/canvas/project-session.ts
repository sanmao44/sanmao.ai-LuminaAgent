import type { CanvasDocument } from './types';
import { normalizeDocument } from './model';
import {
  ensureCanvasStorage,
  loadCanvasDocument,
  retainedCanvasProjectId,
  saveCanvasActiveProject,
  saveCanvasDocument,
} from './storage';

function documentSignature(document: CanvasDocument) {
  return JSON.stringify(normalizeDocument(document));
}

/** Per-view persistence adapter. CanvasCore remains the document/history owner. */
export class CanvasProjectSession {
  activeId = '';
  private persisted: CanvasDocument | null = null;

  hasUnsavedChanges(document: CanvasDocument) {
    return Boolean(this.activeId && this.persisted && documentSignature(document) !== documentSignature(this.persisted));
  }

  open(id: string) {
    this.activeId = id;
    this.persisted = loadCanvasDocument(id);
    saveCanvasActiveProject(id);
    return this.persisted;
  }

  save(document: CanvasDocument) {
    if (!this.activeId || !this.persisted) return true;
    if (!saveCanvasDocument(this.activeId, document, this.persisted)) return false;
    this.persisted = normalizeDocument(document);
    return true;
  }

  refresh(document: CanvasDocument) {
    const storage = ensureCanvasStorage();
    const activeId = retainedCanvasProjectId(storage.projects, this.activeId, storage.activeId)!;
    // A refresh must not replace an editing document, nor reset its undo history.
    if (this.hasUnsavedChanges(document)) return { projects: storage.projects, activeId: this.activeId, migrated: storage.migrated };
    const stored = loadCanvasDocument(activeId);
    const changed = activeId !== this.activeId || !this.persisted || documentSignature(stored) !== documentSignature(this.persisted);
    this.activeId = activeId;
    this.persisted = stored;
    return { projects: storage.projects, activeId, migrated: storage.migrated, ...(changed ? { document: stored } : {}) };
  }
}
