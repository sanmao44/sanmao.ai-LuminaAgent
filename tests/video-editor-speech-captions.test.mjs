import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const editor = createTsRequire(process.cwd())('./lib/canvas/video-editor');
const transcript = '第一句。第二句。';
const audio = (id, start = 0, sourceOffset = 0, duration = 8) => ({
  id, sourceNodeId: 'voice-node', track: 'audio', type: 'audio', name: id,
  start, sourceOffset, duration, playbackRate: 1,
});
const normalize = (clips) => editor.normalizeVideoEditorState({ clips });
const draft = (state, clipId, text = transcript) => {
  const clip = state.clips.find((item) => item.id === clipId);
  const result = editor.addVideoEditorSpeechCaptions(state, {
    sourceNodeId: clip.sourceNodeId, sourceClipId: clip.id, text,
    start: clip.start, durationSeconds: clip.duration, sourceOffset: clip.sourceOffset,
    sourceDurationSeconds: 8, playbackRate: clip.playbackRate,
  });
  assert.equal(result.reason, undefined);
  return result.state;
};
const captions = (state, clipId) => state.clips.filter((clip) => clip.generatedFromClipId === clipId);

test('regeneration changes only one repeated audio instance, retaining other instances and styles', () => {
  let state = draft(normalize([audio('first'), audio('second', 10)]), 'first');
  state = draft(state, 'second');
  const original = structuredClone(state);
  const firstCaption = captions(state, 'first')[0];
  state = editor.updateVideoEditorClip(state, firstCaption.id, { fontSize: 60, text: '手动润色' });
  const secondCaptions = captions(state, 'second');
  const next = draft(state, 'first', '新文案。');
  assert.equal(captions(next, 'first').length, 1);
  assert.equal(captions(next, 'first')[0].text, '新文案。');
  assert.equal(captions(next, 'first')[0].fontSize, 60);
  assert.deepEqual(captions(next, 'second'), secondCaptions);
  assert.equal(captions(original, 'first')[0].text, '第一句。');
  assert.notDeepEqual(next, original);
  assert.deepEqual(editor.normalizeVideoEditorState(JSON.parse(JSON.stringify(next))), next);
});

test('trimmed and accelerated audio maps only intersecting source cues to the timeline', () => {
  const clip = { ...audio('trimmed', 3, 4, 2), playbackRate: 2 };
  const next = draft(normalize([clip]), clip.id);
  const cues = captions(next, clip.id);
  assert.equal(cues.length, 1);
  assert.equal(cues[0].text, '第二句。');
  assert.equal(cues[0].start, 3);
  assert.equal(cues[0].duration, 2);
  assert.equal(editor.clipEnd(cues[0]), editor.clipEnd(clip));
});

test('moving, trimming and changing audio speed carries edited captions and preserves manual overlays', () => {
  const manual = { id: 'manual', track: 'caption', type: 'caption', name: '片尾', text: '手工', start: 15, duration: 1, sourceOffset: 0 };
  const original = draft(normalize([audio('voice'), manual]), 'voice');
  let moved = editor.moveVideoEditorClip(original, 'voice', 2);
  assert.deepEqual(captions(moved, 'voice').map((cue) => cue.start), [2, 6]);
  const lastCue = captions(moved, 'voice')[1];
  moved = editor.updateVideoEditorClip(moved, lastCue.id, { text: '校对后的第二句', fontSize: 50 });
  const trimmed = editor.trimVideoEditorClip(moved, 'voice', 6, 10);
  assert.equal(captions(trimmed, 'voice').length, 1);
  assert.equal(captions(trimmed, 'voice')[0].text, '校对后的第二句');
  assert.equal(captions(trimmed, 'voice')[0].fontSize, 50);
  const fast = editor.updateVideoEditorClip(trimmed, 'voice', { playbackRate: 2 });
  assert.equal(captions(fast, 'voice')[0].start, 6);
  assert.equal(captions(fast, 'voice')[0].duration, 2);
  assert.deepEqual(fast.clips.find((clip) => clip.id === 'manual'), original.clips.find((clip) => clip.id === 'manual'));
  assert.deepEqual(captions(original, 'voice').map((cue) => cue.start), [0, 4]);
});

test('split audio rebinds captions, allowing the right half to regenerate or move independently', () => {
  const original = draft(normalize([audio('voice')]), 'voice');
  const split = editor.splitVideoEditorClip(original, 'voice', 4);
  const rightId = 'voice-split-4000';
  assert.equal(captions(split, 'voice').length, 1);
  assert.equal(captions(split, rightId).length, 1);
  const regenerated = draft(split, rightId);
  assert.deepEqual(captions(regenerated, 'voice'), captions(split, 'voice'));
  assert.equal(captions(regenerated, rightId)[0].text, '第二句。');
  const moved = editor.moveVideoEditorClip(regenerated, rightId, 10);
  assert.equal(captions(moved, rightId)[0].start, 10);
  assert.equal(captions(moved, 'voice')[0].start, 0);
  const removed = editor.removeVideoEditorClip(moved, rightId);
  assert.equal(captions(removed, rightId).length, 0);
  assert.equal(captions(removed, 'voice').length, 1);
});

test('splitting through a caption preserves both text fragments with unique ids and matching audio owners', () => {
  const original = draft(normalize([audio('voice')]), 'voice');
  const split = editor.splitVideoEditorClip(original, 'voice', 2);
  const left = captions(split, 'voice');
  const right = captions(split, 'voice-split-2000');
  assert.equal(left.length, 1);
  assert.equal(left[0].duration, 2);
  assert.equal(right.length, 2);
  assert.equal(right[0].start, 2);
  assert.equal(right[0].duration, 2);
  assert.equal(left[0].text, right[0].text);
  assert.equal(new Set(split.clips.map((clip) => clip.id)).size, split.clips.length);
});

test('deleting and reordering audio ripples its captions and removing connections drops only linked drafts', () => {
  const original = draft(draft(normalize([audio('first'), audio('second', 8)]), 'first'), 'second');
  const deleted = editor.removeVideoEditorClip(original, 'first');
  assert.equal(captions(deleted, 'first').length, 0);
  assert.equal(captions(deleted, 'second')[0].start, 0);
  const reordered = editor.reorderVideoEditorClips(original, 'audio', ['second', 'first']);
  assert.equal(captions(reordered, 'second')[0].start, 0);
  assert.equal(captions(reordered, 'first')[0].start, 8);
  const disconnected = editor.syncVideoEditorInputs(original, []);
  assert.equal(disconnected.clips.length, 0);
});

test('video ripple removal maps captions into remaining audio fragments without dangling owners', () => {
  const video = { id: 'cut', track: 'video', type: 'video', name: 'cut', start: 2, duration: 2, sourceOffset: 0 };
  const original = draft(normalize([audio('voice'), video]), 'voice');
  const removed = editor.removeVideoEditorClip(original, 'cut');
  const audios = removed.clips.filter((clip) => clip.type === 'audio');
  const cues = removed.clips.filter((clip) => clip.track === 'caption');
  assert.equal(audios.length, 2);
  assert.equal(cues.length, 2);
  for (const cue of cues) {
    const owner = audios.find((clip) => clip.id === cue.generatedFromClipId);
    assert.ok(owner);
    assert.ok(cue.start >= owner.start && editor.clipEnd(cue) <= editor.clipEnd(owner));
  }
  assert.deepEqual(cues.map((cue) => [cue.start, cue.duration]), [[0, 2], [2, 4]]);
});
