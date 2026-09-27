import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 首次进入的开屏欢迎页：新用户（重新解压一份包、换浏览器）必须能看到，
// 看过一次的老用户不能重复看到，判断出结果之前也不能先画欢迎层再撤掉（闪烁）。
const [component, page, onboarding, route, styles] = await Promise.all([
  readFile(new URL('../components/WelcomeExperience.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../app/page.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../lib/onboarding.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/api/onboarding/route.ts', import.meta.url), 'utf8'),
  readFile(new URL('../app/globals.css', import.meta.url), 'utf8'),
]);

const keyMatch = component.match(/WELCOME_SEEN_STORAGE_KEY\s*=\s*'([^']+)'/);
assert.ok(keyMatch, 'WelcomeExperience.tsx 必须导出本机是否看过开屏的 localStorage 键名');
const welcomeKey = keyMatch[1];

test('开屏判断以本次安装的服务端标记为准', () => {
  assert.match(page, /fetch\('\/api\/onboarding'/);
  assert.match(page, /typeof data\?\.seen === 'boolean'\)\s*seen = data\.seen/);
});

test('本机标记只是服务端不可用时的兜底', () => {
  assert.match(page, /import WelcomeExperience, \{ WELCOME_SEEN_STORAGE_KEY \} from '@\/components\/WelcomeExperience';/);
  assert.match(page, /seen = localStorage\.getItem\(WELCOME_SEEN_STORAGE_KEY\) === '1'/);
  assert.match(route, /hasSeenWelcome/);
  assert.match(route, /markWelcomeSeen/);
  assert.match(onboarding, /welcome\.json/);
});

test('判断出结果之前渲染过渡层，避免欢迎页一闪而过', () => {
  assert.match(page, /if \(welcomeStage === 'boot'\) \{\s*return[^}]*welcome-boot/);
  assert.match(page, /if \(welcomeStage === 'welcome'\) \{\s*return[^}]*WelcomeExperience/);
  assert.match(styles, /\.welcome-boot\{[^}]*position:fixed/);
});
