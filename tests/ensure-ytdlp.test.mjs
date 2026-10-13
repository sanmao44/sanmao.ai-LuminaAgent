import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';

const { ensureYtDlp } = await import('../scripts/ensure-ytdlp.mjs');

async function createInstalledBinary(dataDir, bytes = 0x11) {
  const target = path.join(dataDir, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.alloc(1024 * 1024 + 1, bytes));
  return target;
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function withDownloadProxy(callback) {
  const body = Buffer.alloc(1024 * 1024 + 1, 0x33);
  let requests = 0;
  let tunnels = 0;
  const origin = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(body);
  });
  const originPort = await listen(origin);
  const proxy = createServer();
  proxy.on('connect', (_request, client, head) => {
    tunnels += 1;
    const upstream = connect(originPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  const proxyPort = await listen(proxy);
  try {
    await callback({ proxyPort, requests: () => requests, tunnels: () => tunnels, body });
  } finally {
    await close(proxy);
    await close(origin);
  }
}

function downloadRunProcess(command, args) {
  if (args[0] === '--version') return { exitCode: 0, stdout: '2026.10.13\n', stderr: '' };
  throw new Error(`Unexpected process arguments for ${command}`);
}

test('refreshes the installed downloader through yt-dlp official self-update', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ensure-ytdlp-'));
  const now = Date.UTC(2026, 9, 12);
  let version = '2026.08.19';
  let updates = 0;
  try {
    const target = await createInstalledBinary(dataDir);
    const runProcess = async (command, args) => {
      if (args[0] === '--version') return { exitCode: 0, stdout: `${version}\n`, stderr: '' };
      if (args[0] === '-U') {
        updates += 1;
        version = '2026.10.12';
        await writeFile(target, Buffer.alloc(1024 * 1024 + 1, 0x22));
        return { exitCode: 0, stdout: 'Updated', stderr: '' };
      }
      throw new Error(`Unexpected process arguments for ${command}`);
    };

    const ready = await ensureYtDlp({ dataDir, quiet: true, now: () => now, runProcess });

    assert.equal(ready, true);
    assert.equal(updates, 1);
    assert.equal((await readFile(target))[0], 0x22);
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'tools', 'yt-dlp-update-check.json'), 'utf8')), { checkedAt: now });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('keeps a usable downloader when its update check is offline', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ensure-ytdlp-'));
  try {
    const target = await createInstalledBinary(dataDir);
    let updates = 0;
    const runProcess = async (_command, args) => {
      if (args[0] === '--version') return { exitCode: 0, stdout: '2026.08.19\n', stderr: '' };
      if (args[0] === '-U') {
        updates += 1;
        throw new Error('network unavailable');
      }
      throw new Error('Unexpected process arguments');
    };

    const ready = await ensureYtDlp({ dataDir, quiet: true, runProcess });

    assert.equal(ready, true);
    assert.equal(updates, 1);
    assert.equal((await readFile(target))[0], 0x11);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('does not check the upstream release again within the refresh interval', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ensure-ytdlp-'));
  const now = Date.UTC(2026, 9, 12);
  try {
    await createInstalledBinary(dataDir);
    await writeFile(
      path.join(dataDir, 'tools', 'yt-dlp-update-check.json'),
      JSON.stringify({ checkedAt: now - 60 * 60 * 1000 }),
    );
    let updates = 0;
    const runProcess = async (_command, args) => {
      if (args[0] === '--version') return { exitCode: 0, stdout: '2026.08.19\n', stderr: '' };
      if (args[0] === '-U') updates += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    };

    const ready = await ensureYtDlp({ dataDir, quiet: true, now: () => now, runProcess });

    assert.equal(ready, true);
    assert.equal(updates, 0);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('first install fetches through the configured HTTP proxy', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ensure-ytdlp-'));
  try {
    await withDownloadProxy(async ({ proxyPort, requests, tunnels, body }) => {
      const ready = await ensureYtDlp({
        dataDir,
        quiet: true,
        env: {
          SANMAO_YTDLP_DOWNLOAD_URL: 'http://download.invalid/yt-dlp.exe',
          HTTP_PROXY: `http://127.0.0.1:${proxyPort}`,
          NO_PROXY: '',
        },
        runProcess: downloadRunProcess,
      });
      assert.equal(ready, true);
      assert.equal(tunnels(), 1);
      assert.equal(requests(), 1);
      const target = path.join(dataDir, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
      assert.deepEqual(await readFile(target), body);
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('first install reads macOS system proxy when the environment has none', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'sanmao-ensure-ytdlp-'));
  try {
    await withDownloadProxy(async ({ proxyPort, requests, tunnels }) => {
      let scutilCalls = 0;
      const ready = await ensureYtDlp({
        dataDir,
        quiet: true,
        platform: 'darwin',
        env: { SANMAO_YTDLP_DOWNLOAD_URL: 'http://download.invalid/yt-dlp.exe' },
        runProcess: (command, args) => {
          if (command === 'scutil' && args[0] === '--proxy') {
            scutilCalls += 1;
            return { exitCode: 0, stdout: `HTTPEnable : 1\nHTTPProxy : 127.0.0.1\nHTTPPort : ${proxyPort}\n`, stderr: '' };
          }
          return downloadRunProcess(command, args);
        },
      });
      assert.equal(ready, true);
      assert.equal(scutilCalls, 1);
      assert.equal(tunnels(), 1);
      assert.equal(requests(), 1);
    });
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
