import assert from 'node:assert/strict';
import { createTsRequire } from './ts-require.mjs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const nodeRequire = createTsRequire(process.cwd());
let hookValues = [];
let hookIndex = 0;
let requestResume = async () => ({ message: "ok" });
const require = (specifier) => {
  if (specifier === "react") {
    return { useState: (initial) => {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], (next) => { hookValues[index] = typeof next === "function" ? next(hookValues[index]) : next; }];
    } };
  }
  if (specifier === "@/lib/agent-client") return { resumeAgentRun: (...args) => requestResume(...args) };
  return nodeRequire(specifier);
};
function renderComponent(props) { hookIndex = 0; return AgentApprovalResult(props); }
function findElements(node, predicate) {
  if (Array.isArray(node)) return node.flatMap((child) => findElements(child, predicate));
  if (!node || typeof node !== "object") return [];
  return [...(predicate(node) ? [node] : []), ...findElements(node.props?.children, predicate)];
}
const source = await readFile(new URL('../components/AgentApprovalResult.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const componentModule = { exports: {} };
new Function('require', 'module', 'exports', compiled)(require, componentModule, componentModule.exports);
const AgentApprovalResult = componentModule.exports.default;

test('approval result keeps the existing message outcome presentation', () => {
  const markup = renderToStaticMarkup(createElement(AgentApprovalResult, { message: '已执行完成。' }));
  assert.equal(markup, '<div class="message-approval-result"><span>已执行完成。</span></div>');
});

test("a consumed undo conflict is persisted as a terminal result with no retry button", async () => {
  hookValues = [];
  const undo = { id: "undo_conflict", path: "C:/fixture/file.txt", expiresAt: Date.now() + 60_000 };
  const conflictText = "文件在这次编辑后已发生变化，撤销没有执行。请保留并核对最新内容。";
  let outcome;
  requestResume = async (id, action) => {
    assert.equal(id, undo.id);
    assert.equal(action, "undo");
    throw Object.assign(new Error(conflictText), { consumed: true });
  };
  const props = { message: "已写入本次文件修改。", filesystemUndos: [undo], onResolved: (value) => { outcome = value; } };
  const tree = renderComponent(props);
  const [button] = findElements(tree, (element) => element.type === "button");
  await button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(outcome.message, new RegExp(conflictText));
  assert.match(outcome.message, /撤销记录已结束，按钮已移除/);
  assert.deepEqual(outcome.filesystemUndos, []);
  const resolvedTree = renderComponent({ ...props, ...outcome });
  assert.equal(findElements(resolvedTree, (element) => element.type === "button").length, 0);
});

test("a transport failure keeps the undo button available for a real retry", async () => {
  hookValues = [];
  const undo = { id: "undo_retry", path: "C:/fixture/file.txt", expiresAt: Date.now() + 60_000 };
  let outcome;
  requestResume = async () => { throw new Error("网络连接中断"); };
  const props = { message: "已写入本次文件修改。", filesystemUndos: [undo], onResolved: (value) => { outcome = value; } };
  const tree = renderComponent(props);
  const [button] = findElements(tree, (element) => element.type === "button");
  await button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcome, undefined);
  const retryTree = renderComponent(props);
  assert.equal(findElements(retryTree, (element) => element.type === "button").length, 1);
  assert.equal(findElements(retryTree, (element) => element.props?.role === "alert").length, 1);
});


test('an unverified undo response keeps the button and tells the user to inspect the file', async () => {
  hookValues = [];
  const undo = { id: 'undo_unknown', path: 'C:/fixture/file.txt', expiresAt: Date.now() + 60_000 };
  let outcome;
  requestResume = async () => {
    throw new Error('撤销请求已发出，但服务器响应无法核对；请先检查文件，再决定是否重试。');
  };
  const props = { message: '已写入本次文件修改。', filesystemUndos: [undo], onResolved: (value) => { outcome = value; } };
  const tree = renderComponent(props);
  const [button] = findElements(tree, (element) => element.type === 'button');
  await button.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(outcome, undefined);
  const retryTree = renderComponent(props);
  assert.equal(findElements(retryTree, (element) => element.type === 'button').length, 1);
  const [alert] = findElements(retryTree, (element) => element.props?.role === 'alert');
  assert.match(alert.props.children, /先检查文件/);
});
