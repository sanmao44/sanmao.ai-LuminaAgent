import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  clearImageStudioDraft,
  hasImageStudioDraftContent,
  loadImageStudioDraft,
  saveImageStudioDraft,
} = createTsRequire(process.cwd())('./lib/creation/image-studio-draft');

const STORAGE_KEY = 'sanmao.image-studio-draft.v1';

class MemoryStorage {
  values = new Map();

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, value);
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const draft = (overrides = {}) => ({
  prompt: 'A quiet city after rain',
  workflow: 'generate',
  hasUnpersistedReferences: false,
  ...overrides,
});

test('image studio draft restores prompt and workflow but stores no reference payload', () => {
  const storage = new MemoryStorage();
  assert.equal(saveImageStudioDraft(draft({ workflow: 'upscale', hasUnpersistedReferences: true }), storage), true);

  const restored = loadImageStudioDraft(storage);
  assert.deepEqual(restored, {
    version: 1,
    savedAt: restored.savedAt,
    ...draft({ workflow: 'upscale', hasUnpersistedReferences: true }),
  });
  assert.equal('references' in restored, false);
  assert.equal('mask' in restored, false);
});

test('image studio draft ignores malformed, oversized, inline-media, and unsupported values', () => {
  const storage = new MemoryStorage();
  for (const raw of [
    '{bad json',
    'x'.repeat(24_001),
    JSON.stringify({ version: 2, savedAt: 1, ...draft() }),
    JSON.stringify({ version: 1, savedAt: 1, ...draft({ prompt: 'data:image/png;base64,AAAA' }) }),
    JSON.stringify({ version: 1, savedAt: 1, ...draft({ prompt: 'x'.repeat(16_001) }) }),
  ]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.equal(loadImageStudioDraft(storage), null);
  }
});

test('image studio draft treats empty generate state as cleared and upscale mode as recoverable', () => {
  const storage = new MemoryStorage();
  assert.equal(hasImageStudioDraftContent(draft({ prompt: '   ' })), false);
  assert.equal(hasImageStudioDraftContent(draft({ prompt: '', workflow: 'upscale' })), true);

  assert.equal(saveImageStudioDraft(draft(), storage), true);
  assert.equal(saveImageStudioDraft(draft({ prompt: '', workflow: 'generate' }), storage), true);
  assert.equal(loadImageStudioDraft(storage), null);

  assert.equal(saveImageStudioDraft(draft({ prompt: '', workflow: 'upscale' }), storage), true);
  assert.equal(loadImageStudioDraft(storage).workflow, 'upscale');
});

test('image studio draft storage failures are contained and saved state can be cleared', () => {
  const blockedStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveImageStudioDraft(draft(), blockedStorage), false);
  assert.equal(loadImageStudioDraft(blockedStorage), null);
  assert.equal(clearImageStudioDraft(blockedStorage), false);

  const storage = new MemoryStorage();
  assert.equal(saveImageStudioDraft(draft(), storage), true);
  assert.equal(clearImageStudioDraft(storage), true);
  assert.equal(loadImageStudioDraft(storage), null);
});
