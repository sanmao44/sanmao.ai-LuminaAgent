import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DOCUMENT_URL = 'https://ai.cangyuansuanli.cn/docs-static/getting-started/chapters/minimax/minimax-speech.md';
export const PREVIEW_ROOT = 'https://tmp.cangyuansuanli.cn/docs/minimax-speech/';
const outputPath = path.join(root, 'packages/contracts/cangyuan-minimax-voices.json');
const expectedVoiceCount = 327;
const languageLabels = Object.freeze({ 普通话: '中文（普通话）', 粤语: '中文（粤语）', 印尼语: '印度尼西亚语' });

/** Parse only the documented voice cards, retaining the provider's exact IDs and names. */
export function parseCangyuanMiniMaxVoiceDocument(markdown) {
  const result = [];
  const ids = new Set();
  let language = '';
  let inVoices = false;
  for (const line of String(markdown).split(/\r?\n/u)) {
    if (!inVoices) {
      const heading = /^###\s+(.+?)\s*$/u.exec(line);
      if (heading) language = heading[1];
      if (line.trim() === '```voices') {
        if (!language) throw new Error('音色列表缺少语言分类。');
        inVoices = true;
      }
      continue;
    }
    if (line.trim() === '```') {
      inVoices = false;
      continue;
    }
    if (!line.trim()) continue;
    const match = /^([^\t]+)\t(voice_builtin_[a-f0-9]{64})\s*$/u.exec(line);
    if (!match || !match[1].trim()) throw new Error('官方音色记录格式发生变化，未导入。');
    const [, name, voiceId] = match;
    if (ids.has(voiceId)) throw new Error(`官方音色编号重复：${voiceId}`);
    ids.add(voiceId);
    result.push({
      number: result.length + 1,
      language,
      languageLabel: languageLabels[language] || language,
      voiceId,
      name: name.trim(),
      previewUrl: new URL(`${voiceId}.mp3`, PREVIEW_ROOT).href,
    });
  }
  if (inVoices) throw new Error('官方音色列表代码块未结束，未导入。');
  if (!result.length) throw new Error('官方文档没有有效的音色列表，未导入。');
  return result;
}

/** HEAD checks never invoke speech generation and do not require API credentials. */
export async function verifyCangyuanMiniMaxVoicePreviews(voices, { request = fetch, concurrency = 8 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error('试听检查并发数必须介于 1 到 8。');
  }
  let nextIndex = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, voices.length) }, async () => {
    while (!failure && nextIndex < voices.length) {
      const voice = voices[nextIndex++];
      try {
        const expectedUrl = new URL(`${voice.voiceId}.mp3`, PREVIEW_ROOT).href;
        if (!/^voice_builtin_[a-f0-9]{64}$/u.test(voice.voiceId) || voice.previewUrl !== expectedUrl) {
          throw new Error(`试听地址与音色编号不匹配：${voice.voiceId}`);
        }
        const response = await request(voice.previewUrl, {
          method: 'HEAD',
          redirect: 'error',
          signal: AbortSignal.timeout(20000),
        });
        const contentType = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
        if (!response.ok || contentType !== 'audio/mpeg') {
          throw new Error(`官方样音不可用：${voice.voiceId}（HTTP ${response.status}，${contentType || '未知类型'}）`);
        }
      } catch (error) {
        failure ||= error;
      }
    }
  }));
  if (failure) throw failure;
  return voices.length;
}

export async function importCangyuanMiniMaxVoices({ request = fetch, destination = outputPath } = {}) {
  const response = await request(DOCUMENT_URL, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`官方音色文档请求失败：HTTP ${response.status}`);
  const voices = parseCangyuanMiniMaxVoiceDocument(await response.text());
  if (voices.length !== expectedVoiceCount) {
    throw new Error(`官方音色数量为 ${voices.length}，与已核对的 ${expectedVoiceCount} 不符，需检查文档变化后再导入。`);
  }
  await verifyCangyuanMiniMaxVoicePreviews(voices, { request });
  const temporaryPath = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(voices, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, destination);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  return voices;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importCangyuanMiniMaxVoices().then((voices) => {
    console.log(`已导入 ${voices.length} 个官方音色；所有样音均通过 HEAD 检查，未调用生成接口。`);
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : '官方音色导入失败。');
    process.exitCode = 1;
  });
}
