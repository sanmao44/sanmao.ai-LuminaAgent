#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isReleaseMediaRelayConfigValid } from './media-relay-policy.mjs';

const configPath = fileURLToPath(new URL('../relay/default-config.json', import.meta.url));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!isReleaseMediaRelayConfigValid(config)) {
  console.error('共享中转地址无效；配置时必须使用公网 HTTPS 根地址。');
  process.exitCode = 1;
} else if (!String(config.defaultMediaRelayUrl || '').trim()) {
  console.log('未配置共享中转地址；发行版将使用启动器的临时中转通道。');
} else {
  console.log('共享媒体中转发布配置有效。');
}
