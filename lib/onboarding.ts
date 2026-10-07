import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveProviderConfigDir } from './data-paths';

/**
 * 开屏欢迎页按「本次安装」判断，标记写在安装目录的数据目录里：
 * 新用户（换浏览器、重新解压一份包）都能看到开屏，原地升级的老用户不会被打扰。
 */
const markerPath = path.join(resolveProviderConfigDir(), 'welcome.json');

export async function hasSeenWelcome(): Promise<boolean> {
  try {
    const raw = await readFile(markerPath, 'utf8');
    return Boolean(JSON.parse(raw)?.seenAt);
  } catch {
    return false;
  }
}

export async function markWelcomeSeen(): Promise<void> {
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify({ seenAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
}
