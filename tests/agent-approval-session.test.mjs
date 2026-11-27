import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const { applyApprovalOutcomeToSession, mergeResolvedApprovalOutcomes, queueSessionMutation } = createTsRequire(process.cwd())('./lib/agent/approval-session');

const fileApproval = {
  id: 'approval-file', role: 'assistant', content: '请核对文件差异，确认后写入。',
  approval: { id: 'apv-file-1', message: '请核对文件差异，确认后写入。', calls: [{ filesystemDiff: '-old\n+new' }] },
};
const ordinaryApproval = {
  id: 'approval-ordinary', role: 'assistant', content: '这一步会修改外部数据，确认后继续。',
  approval: { id: 'apv-ordinary-1', message: '这一步会修改外部数据，确认后继续。', calls: [{ tool: 'publish', risk: 'write' }] },
};

function clone(value) {
  return structuredClone(value);
}

function chat(id, messages) {
  return { id, title: id, createdAt: 1, updatedAt: 1, messages, persona: '' };
}

function createStore(sessions) {
  const store = new Map(sessions.map((session) => [session.id, clone(session)]));
  let saveCount = 0;
  return {
    store,
    get(id) { return store.has(id) ? clone(store.get(id)) : null; },
    save(session) { saveCount += 1; store.set(session.id, clone(session)); },
    remove(id) { store.delete(id); },
    saveCount() { return saveCount; },
  };
}

test('审批结果只更新触发它的会话，并按行为清除重复文件提示', () => {
  const chatA = chat('chat-a', [fileApproval, ordinaryApproval]);
  const store = createStore([chatA, chat('chat-b', [{ id: 'message-b', role: 'assistant', content: 'B 的内容' }])]);
  const undo = { id: 'undo-1', path: 'notes.txt', expiresAt: Date.now() + 60_000 };
  const first = applyApprovalOutcomeToSession(store.get('chat-a'), 'approval-file', { message: '文件已写入。', filesystemUndos: [undo] }, 10);
  assert.ok(first);
  store.save(first);
  const second = applyApprovalOutcomeToSession(store.get('chat-a'), 'approval-ordinary', { message: '已完成。' }, 20);
  assert.ok(second);
  store.save(second);

  const saved = store.get('chat-a');
  assert.equal(saved.messages[0].content, '');
  assert.equal(saved.messages[0].approval, undefined);
  assert.equal(saved.messages[0].approvalResult, '文件已写入。');
  assert.deepEqual(saved.messages[0].filesystemUndos, [undo]);
  assert.equal(saved.messages[1].content, ordinaryApproval.content);
  assert.equal(saved.messages[1].approval, undefined);
  assert.equal(saved.messages[1].approvalResult, '已完成。');
  assert.equal(store.get('chat-b').messages[0].content, 'B 的内容');
});

test('生成中的旧消息快照保留已持久化的撤销结果', () => {
  const initial = chat('chat-a', [fileApproval]);
  const undo = { id: 'undo-during-generation', path: 'notes.txt', expiresAt: Date.now() + 60_000 };
  const resolved = applyApprovalOutcomeToSession(initial, 'approval-file', {
    message: '文件已写入。', filesystemUndos: [undo],
  }, 10);
  assert.ok(resolved);

  const lateSnapshot = [
    fileApproval,
    { id: 'new-user-message', role: 'user', content: '继续回答' },
    { id: 'pending-reply', role: 'assistant', content: '正在回答…', pending: true },
  ];
  const merged = mergeResolvedApprovalOutcomes(lateSnapshot, resolved.messages);
  assert.equal(merged[0].approval, undefined);
  assert.equal(merged[0].content, '');
  assert.equal(merged[0].approvalResult, '文件已写入。');
  assert.equal(merged[0].resolvedApprovalId, fileApproval.approval.id);
  assert.deepEqual(merged[0].filesystemUndos, [undo]);
  assert.deepEqual(merged.slice(1), lateSnapshot.slice(1));

  const retryApproval = { ...fileApproval, approval: { ...fileApproval.approval, id: 'apv-file-retry' } };
  const retried = mergeResolvedApprovalOutcomes([retryApproval], resolved.messages);
  assert.equal(retried[0].approval.id, 'apv-file-retry');
  assert.equal(retried[0].approvalResult, undefined);
});

test('撤销已批准的文件编辑后，迟到保存不能恢复撤销按钮', async () => {
  const undo = { id: 'undo-once', path: 'notes.txt', expiresAt: Date.now() + 60_000 };
  const approved = applyApprovalOutcomeToSession(chat('chat-a', [fileApproval]), 'approval-file', {
    message: '文件已写入。', filesystemUndos: [undo],
  }, 10);
  assert.ok(approved);
  const [approvedMessage] = approved.messages;
  const lateSnapshot = [...approved.messages, { id: 'new-reply', role: 'assistant', content: '新的回答' }];
  const store = createStore([approved]);
  const queues = new Map();

  await queueSessionMutation(queues, 'chat-a', () => {
    const updated = applyApprovalOutcomeToSession(store.get('chat-a'), 'approval-file', {
      message: '已撤销这次文件改动。', filesystemUndos: [],
    }, 20, approvedMessage);
    assert.ok(updated);
    assert.deepEqual(mergeResolvedApprovalOutcomes(approved.messages, updated.messages), updated.messages);
    store.save(updated);
  });
  await queueSessionMutation(queues, 'chat-a', () => {
    const saved = store.get('chat-a');
    store.save({ ...saved, messages: mergeResolvedApprovalOutcomes(lateSnapshot, saved.messages) });
  });

  const saved = store.get('chat-a');
  assert.equal(saved.messages[0].approvalResult, '已撤销这次文件改动。');
  assert.equal(saved.messages[0].resolvedApprovalId, fileApproval.approval.id);
  assert.deepEqual(saved.messages[0].filesystemUndos, []);
  assert.deepEqual(saved.messages[1], lateSnapshot[1]);
});

test('旧会话的撤销会清除迟到快照中的按钮，并保留当前回复正文', () => {
  const undo = { id: 'undo-legacy', path: 'notes.txt', expiresAt: Date.now() + 60_000 };
  const legacy = chat('chat-a', [{
    id: 'approval-file', role: 'assistant', content: '原有回复',
    approvalResult: '文件已写入。', filesystemUndos: [undo],
  }]);
  const reverted = applyApprovalOutcomeToSession(legacy, 'approval-file', {
    message: '已撤销这次文件改动。', filesystemUndos: [],
  }, 20);
  assert.ok(reverted);
  const oldSnapshot = [{ ...legacy.messages[0], content: '当前选中的回复正文' }];
  const [merged] = mergeResolvedApprovalOutcomes(oldSnapshot, reverted.messages);
  assert.equal(merged.approvalResult, '已撤销这次文件改动。');
  assert.deepEqual(merged.filesystemUndos, []);
  assert.equal(merged.content, '当前选中的回复正文');
});

test('旧撤销响应不能清掉同一消息上更新的审批', () => {
  const undo = { id: 'undo-previous', path: 'notes.txt', expiresAt: Date.now() + 60_000 };
  const approved = applyApprovalOutcomeToSession(chat('chat-a', [fileApproval]), fileApproval.id, {
    message: '文件已写入。', filesystemUndos: [undo],
  });
  assert.ok(approved);
  const [approvedMessage] = approved.messages;
  const nextApproval = { ...approvedMessage, approval: { ...fileApproval.approval, id: 'apv-new' } };
  const nextSession = chat('chat-a', [nextApproval]);
  const undoOutcome = { message: '已撤销旧文件改动。', filesystemUndos: [] };
  assert.equal(applyApprovalOutcomeToSession(nextSession, fileApproval.id, undoOutcome, 20, approvedMessage), null);

  const reverted = applyApprovalOutcomeToSession(approved, fileApproval.id, undoOutcome, 20, approvedMessage);
  assert.ok(reverted);
  assert.equal(mergeResolvedApprovalOutcomes(nextSession.messages, reverted.messages)[0], nextApproval);
});

test('同一会话的审批保存与删除按序执行，删除不会被迟到回调复活', async () => {
  let markSaveStarted;
  let releaseSave;
  const saveStarted = new Promise((resolve) => { markSaveStarted = resolve; });
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  const store = createStore([chat('chat-a', [fileApproval]), chat('chat-b', [{ id: 'message-b', role: 'assistant', content: 'B 的内容' }])]);
  const queues = new Map();
  const resolution = queueSessionMutation(queues, 'chat-a', async () => {
    const session = store.get('chat-a');
    const updated = session && applyApprovalOutcomeToSession(session, 'approval-file', { message: '已写入。' }, 10);
    if (!updated) return;
    markSaveStarted();
    await saveGate;
    store.save(updated);
  });
  await saveStarted;
  const deletion = queueSessionMutation(queues, 'chat-a', () => store.remove('chat-a'));
  releaseSave();
  await Promise.all([resolution, deletion]);

  assert.equal(store.store.has('chat-a'), false);
  assert.deepEqual([...store.store.keys()], ['chat-b']);
  assert.equal(store.get('chat-b').messages[0].content, 'B 的内容');

  await queueSessionMutation(queues, 'chat-a', async () => {
    const session = store.get('chat-a');
    const updated = session && applyApprovalOutcomeToSession(session, 'approval-file', { message: '迟到结果' });
    if (updated) store.save(updated);
  });
  assert.equal(store.store.has('chat-a'), false);
  assert.equal(store.saveCount(), 1);
});

test('审批响应对应的会话不存在时不会写入其他会话', async () => {
  const store = createStore([chat('chat-b', [{ id: 'message-b', role: 'assistant', content: 'B 的内容' }])]);
  const queues = new Map();
  await queueSessionMutation(queues, 'chat-a', async () => {
    const session = store.get('chat-a');
    const updated = session && applyApprovalOutcomeToSession(session, 'approval-file', { message: '已写入。' });
    if (updated) store.save(updated);
  });
  assert.equal(store.store.has('chat-a'), false);
  assert.equal(store.get('chat-b').messages[0].content, 'B 的内容');
  assert.equal(store.saveCount(), 0);
});
