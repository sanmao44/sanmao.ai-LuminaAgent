/**
 * 定位 Node 自带的 npm CLI（npm-cli.js），供 MCP 安装路径使用。
 *
 * 用 process.execPath 直接启动 npm-cli.js，可以不经过 shell，Windows 上也不会
 * 碰到 npm.cmd 的执行限制。npm 与 node 的相对位置随发行布局不同：
 *   - Windows / 官方 zip：<nodeDir>/node_modules/npm/bin/npm-cli.js
 *   - 官方 Unix tarball（含 actions/setup-node）：<nodeDir>/../lib/node_modules/npm/bin/npm-cli.js
 * 只认第一种会在 Linux 上误报「这台机器上找不到 npm」。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

export function resolveNpmCliPath(nodePath: string = process.execPath) {
  const nodeDir = path.dirname(nodePath);
  const candidates = [
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}
