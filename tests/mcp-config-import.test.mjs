import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLibModules } from './lib-build.mjs';

const { main: config } = await buildLibModules(['lib/mcp/config-import'], 'config-import');

test('从地址推断服务名，跳过 mcp/api/www 这类通用前缀', () => {
  assert.equal(config.deriveMcpServerName('https://mcp.notion.com/mcp'), 'notion');
  assert.equal(config.deriveMcpServerName('https://api.githubcopilot.com/mcp'), 'githubcopilot');
  assert.equal(config.deriveMcpServerName('https://www.example.com/mcp'), 'example');
  assert.equal(config.deriveMcpServerName('http://127.0.0.1:8899/mcp'), 'local-mcp');
  assert.equal(config.deriveMcpServerName('不是地址'), 'mcp');
});

test('识别 mcpServers 里的服务：名称、地址、请求头都填好', () => {
  const imported = config.parseMcpConfigText(JSON.stringify({
    mcpServers: {
      github: { url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer token-123' } },
    },
  }));
  assert.equal(imported.name, 'github');
  assert.equal(imported.url, 'https://mcp.example.com/mcp');
  assert.deepEqual(imported.headers, { Authorization: 'Bearer token-123' });
  assert.match(imported.note, /已识别「github」/);
});

test('单个服务对象与 serverUrl 别名同样能识别', () => {
  const imported = config.parseMcpConfigText('{"name":"Notion","serverUrl":"https://mcp.notion.com/mcp","type":"http"}');
  assert.equal(imported.name, 'Notion');
  assert.equal(imported.url, 'https://mcp.notion.com/mcp');
  assert.deepEqual(imported.headers, {});
});

test('直接粘贴地址时按地址推断名称', () => {
  const imported = config.parseMcpConfigText('https://mcp.linear.app/mcp');
  assert.equal(imported.name, 'linear');
  assert.equal(imported.headers && Object.keys(imported.headers).length, 0);
});

test('多个服务时填入第一个并说明还有几个', () => {
  const imported = config.parseMcpConfigText(JSON.stringify({
    mcpServers: {
      a: { url: 'https://a.example.com/mcp' },
      b: { url: 'https://b.example.com/mcp' },
    },
  }));
  assert.equal(imported.name, 'a');
  assert.match(imported.note, /已填入第一个「a」/);
});

test('本地命令型服务给出明确拒绝理由，而不是默默填错', () => {
  assert.throws(
    () => config.parseMcpConfigText('{"mcpServers":{"fs":{"command":"npx","args":["-y","server-filesystem","/tmp"]}}}'),
    /本地命令型（stdio）服务/,
  );
});

test('占位符与请求头会被提示，非法输入报可读错误', () => {
  const imported = config.parseMcpConfigText('{"mcpServers":{"x":{"url":"https://x.com/mcp","headers":{"Authorization":"Bearer ${TOKEN}"}}}}');
  assert.match(imported.note, /占位符/);
  assert.match(imported.note, /请求头已填入/);
  assert.throws(() => config.parseMcpConfigText('   '), /先粘贴/);
  assert.throws(() => config.parseMcpConfigText('{不是 json}'), /不是合法 JSON/);
  assert.throws(() => config.parseMcpConfigText('随便写点东西'), /没认出配置/);
  assert.throws(() => config.parseMcpConfigText('{"mcpServers":{"x":{"type":"http"}}}'), /没有 http\(s\) 地址/);
  assert.equal(config.headersToText({ Authorization: 'Bearer a', 'X-Trace': 'b' }), 'Authorization: Bearer a\nX-Trace: b');
});
