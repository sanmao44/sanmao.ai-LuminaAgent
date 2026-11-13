#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hasReleaseMediaRelayConfig } from './media-relay-policy.mjs';

const configPath = fileURLToPath(new URL('../relay/default-config.json', import.meta.url));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (!hasReleaseMediaRelayConfig(config)) {
  console.error('发布包缺少有效的 HTTPS 共享媒体中转地址；部署并验证 Worker 后填写 relay/default-config.json。');
  process.exitCode = 1;
} else {
  console.log('共享媒体中转发布配置有效。');
}
