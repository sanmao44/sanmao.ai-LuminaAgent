import assert from 'node:assert/strict';
import test from 'node:test';
import { createTsRequire } from './ts-require.mjs';

const modelLibraryEmptyState = createTsRequire(process.cwd())('./components/model-library-empty-state');

test('existing providers lead to management instead of duplicate service creation', () => {
  const copy = modelLibraryEmptyState.modelLibraryEmptyStateCopy({ modelCount: 0, providerCount: 2 });
  assert.equal(copy.actionLabel, '管理接口服务');
  assert.match(copy.description, /读取模型列表/);
});

test('hidden model records point users to existing provider visibility settings', () => {
  const copy = modelLibraryEmptyState.modelLibraryEmptyStateCopy({ modelCount: 4, providerCount: 1 });
  assert.equal(copy.title, '模型暂不可见');
  assert.equal(copy.actionLabel, '检查已有服务商');
  assert.match(copy.description, /已加入模型库/);
});

test('a new workspace offers service creation only when no service is configured', () => {
  const copy = modelLibraryEmptyState.modelLibraryEmptyStateCopy({ modelCount: 0, providerCount: 0 });
  assert.equal(copy.actionLabel, '添加接口服务');
});
