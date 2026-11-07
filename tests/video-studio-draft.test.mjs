import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const {
  clearVideoStudioDraft,
  hasVideoStudioDraftContent,
  loadVideoStudioDraft,
  saveVideoStudioDraft,
} = createTsRequire(process.cwd())('./lib/video-studio-draft');

const STORAGE_KEY = 'sanmao.video-studio-draft.v1';

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

function draft(overrides = {}) {
  return {
    prompt: 'A quiet landscape at sunrise',
    modelId: 'video-model-1',
    operation: 'generate',
    inputMode: 'reference',
    seconds: 8,
    ratio: '16:9',
    resolution: '1080p',
    agnesWidth: 1152,
    agnesHeight: 768,
    agnesNumFrames: 81,
    agnesFrameRate: 24,
    hasUnpersistedMedia: false,
    ...overrides,
  };
}

test('video studio draft round-trips only versioned prompt and scalar settings', () => {
  const storage = new MemoryStorage();

  assert.equal(saveVideoStudioDraft(draft({ hasUnpersistedMedia: true }), storage), true);
  const restored = loadVideoStudioDraft(storage);

  assert.deepEqual(restored, {
    version: 1,
    savedAt: restored.savedAt,
    ...draft({ hasUnpersistedMedia: true }),
  });
  assert.ok(Number.isFinite(restored.savedAt));
});

test('video studio recognizes Agnes-only parameter edits as a draft', () => {
  const defaults = draft({
    prompt: '', modelId: 'auto', operation: 'generate', inputMode: 'text', seconds: 5,
    ratio: '16:9', resolution: '720p', agnesWidth: 1152, agnesHeight: 768,
    agnesNumFrames: 81, agnesFrameRate: 24, hasUnpersistedMedia: false,
  });
  assert.equal(hasVideoStudioDraftContent(defaults), false);
  assert.equal(hasVideoStudioDraftContent({ ...defaults, agnesWidth: 1216 }), true);
  assert.equal(hasVideoStudioDraftContent({ ...defaults, agnesHeight: 832 }), true);
  assert.equal(hasVideoStudioDraftContent({ ...defaults, agnesNumFrames: 89 }), true);
  assert.equal(hasVideoStudioDraftContent({ ...defaults, agnesFrameRate: 30 }), true);
});

test('video studio draft drops media payload fields and normalizes invalid settings', () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEY, JSON.stringify({
    version: 1,
    savedAt: 1,
    ...draft({ seconds: 120, ratio: 'invalid', agnesNumFrames: 82 }),
    firstFrame: { name: 'frame.png', url: 'data:image/png;base64,AAAA' },
    referenceImages: [{ url: 'data:image/png;base64,BBBB' }],
  }));

  const restored = loadVideoStudioDraft(storage);

  assert.equal(restored.seconds, 5);
  assert.equal(restored.ratio, '16:9');
  assert.equal(restored.agnesNumFrames, 81);
  assert.equal(restored.inputMode, 'reference');
  assert.equal('firstFrame' in restored, false);
  assert.equal('referenceImages' in restored, false);
});

test('video studio draft ignores malformed, oversized, and unsupported versions', () => {
  const storage = new MemoryStorage();
  for (const raw of [
    '{bad json',
    'x'.repeat(20_001),
    JSON.stringify({ version: 2, savedAt: 1, ...draft() }),
    JSON.stringify({ version: 1, savedAt: 1, prompt: 'data:video/mp4;base64,AAAA' }),
  ]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.equal(loadVideoStudioDraft(storage), null);
  }
});

test('video studio draft reports storage failures and can clear the saved snapshot', () => {
  const blockedStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('blocked'); },
  };
  assert.equal(saveVideoStudioDraft(draft(), blockedStorage), false);
  assert.equal(loadVideoStudioDraft(blockedStorage), null);
  assert.equal(clearVideoStudioDraft(blockedStorage), false);

  const storage = new MemoryStorage();
  assert.equal(saveVideoStudioDraft(draft(), storage), true);
  assert.equal(clearVideoStudioDraft(storage), true);
  assert.equal(loadVideoStudioDraft(storage), null);
});
