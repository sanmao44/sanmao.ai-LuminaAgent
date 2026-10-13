import type { CanvasDocument } from './types';
import { normalizeDocument } from './model';
import { CanvasCore } from '../../packages/canvas-core/runtime';
import {
  ensureCanvasStorage,
  loadCanvasDocument,
  readCanvasProjects,
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

  /** Bind late media/task callbacks to their originating project, not the displayed tab. */
  capture(view: {
    mounted(): boolean;
    document(): CanvasDocument;
    update(updater: (document: CanvasDocument) => CanvasDocument): void;
    commit(updater: (document: CanvasDocument) => CanvasDocument): void;
    onFailure(): void;
  }, projectId = this.activeId) {
    const isActive = () => view.mounted() && this.activeId === projectId;
    const readDocument = () => isActive() ? view.document() : loadCanvasDocument(projectId);
    const apply = (updater: (document: CanvasDocument) => CanvasDocument, record: boolean) => {
      if (!projectId || !readCanvasProjects().some((project) => project.id === projectId)) return false;
      if (isActive()) {
        (record ? view.commit : view.update)(updater);
        return true;
      }
      // Apply to the latest persisted document via the existing Core, preserving
      // edits from other pages. No stale whole-document snapshot is written back.
      const previous = loadCanvasDocument(projectId);
      const core = new CanvasCore(previous);
      const result = core.apply({ id: 'background-result', label: 'canvas.background-result', apply: updater });
      if (!result.changed) return true;
      if (!saveCanvasDocument(projectId, result.document, previous)) {
        view.onFailure();
        return false;
      }
      return true;
    };
    return { projectId, isActive, readDocument,
      updateDoc: (updater: (document: CanvasDocument) => CanvasDocument) => apply(updater, false),
      commit: (updater: (document: CanvasDocument) => CanvasDocument) => apply(updater, true),
    };
  }

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
