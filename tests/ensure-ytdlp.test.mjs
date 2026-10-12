import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

const { ensureYtDlp } = await import('../scripts/ensure-ytdlp.mjs');

async function createInstalledBinary(dataDir, bytes = 0x11) {
  const target = path.join(dataDir, 'tools', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.alloc(1024 * 1024 + 1, bytes));
  return target;
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
