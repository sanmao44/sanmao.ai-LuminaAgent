/**
 * 本机离线配音：不联网、不消耗任何额度，用系统自带的语音合成引擎出声。
 *
 * 解决场景：用户一个 TTS 模型都没配时，「一键克隆出片」只能出「无声 + 字幕」。
 * Windows 走 System.Speech（自带 Microsoft Huihui 中文音色），macOS 走系统命令 say
 * （内置中文音色，如 Tingting / Meijia），两条路都不装依赖、不花钱。
 *
 * 实测踩到的坑：
 * 1) Windows 中文不能走命令行参数：PowerShell 的代码页会把中文转成乱码，必须写临时文件再读。
 * 2) 系统默认音色经常是英文（Zira / David / Samantha）：先按用户指定音色选，选不上必须退回中文音色。
 *    旧实现只把 SelectVoice 的失败 catch 掉，会静默留在英文音色上，中文等于没念。
 * 3) macOS 的 say 只写 AIFF，而 Chromium 播不了 AIFF：用系统自带的 afconvert 转 WAV，和 Windows 产物保持一致。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SpeechAudio } from './speech';

export const OFFLINE_SPEECH_LABEL = '本机离线配音';
const SYNTH_TIMEOUT_MS = 60_000;

/** 离线合成的产物：多带一个「实际用了哪个音色」，用户填了别的平台的音色名时能提醒他。 */
export type OfflineSpeechAudio = SpeechAudio & { voice?: string };

/** 纯 ASCII 脚本：PS 5.1 会按 ANSI 读 .ps1，中文写进去会变成乱码。 */
const POWERSHELL_SCRIPT = `param([string]$TextFile, [string]$OutFile, [string]$Voice)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$chosen = ''
if ($Voice) { try { $s.SelectVoice($Voice); $chosen = $s.Voice.Name } catch { } }
if (-not $chosen) {
  $zh = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
  if ($zh) { try { $s.SelectVoice($zh.VoiceInfo.Name); $chosen = $s.Voice.Name } catch { } }
}
if (-not $chosen) { $chosen = $s.Voice.Name }
[Console]::Error.WriteLine('VOICE:' + $chosen)
$s.SetOutputToWaveFile($OutFile)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
`;

/** Windows 与 macOS 都有这条零成本路径（Linux 桌面没有统一的中文 TTS，维持原来的降级链）。 */
export function offlineSpeechSupported() {
  return process.platform === 'win32' || process.platform === 'darwin';
}

function runCommand(command: string, args: string[], timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 已经退出 */ }
      reject(new Error('本机离线配音超时，已终止。'));
    }, Math.max(5_000, timeoutMs));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000); });
    child.once('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`无法启动系统语音合成（${error.code || error.message}）。`));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stderr);
      else reject(new Error(`系统语音合成失败（退出码 ${code}）：${stderr.replace(/\s+/g, ' ').trim().slice(0, 180) || '无输出'}`));
    });
  });
}

/** 从系统自带的语音列表里挑一个中文音色；取不到就留空，交给系统默认音色。 */
let macVoicePromise: Promise<string> | null = null;
async function macChineseVoice() {
  if (!macVoicePromise) macVoicePromise = runCommand('say', ['-v', '?'], 15_000).catch(() => '');
  const listing = await macVoicePromise;
  for (const line of listing.split(/\r?\n/)) {
    // 形如：Tingting            zh_CN    # 您好，我叫Tingting。
    const columns = line.split(/\s{2,}/).map((item) => item.trim());
    const name = columns[0] || '';
    const locale = columns.slice(1).find((item) => /^[a-z]{2}[-_][A-Za-z]{2,}/.test(item)) || '';
    if (name && /^zh[-_]/i.test(locale)) return name;
  }
  return '';
}

async function synthesizeOnWindows(content: string, options: { voice?: string }): Promise<OfflineSpeechAudio> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sanmao-offline-voice-'));
  try {
    const scriptFile = path.join(directory, 'speak.ps1');
    const textFile = path.join(directory, 'line.txt');
    const outFile = path.join(directory, 'line.wav');
    await writeFile(scriptFile, POWERSHELL_SCRIPT, 'utf8');
    await writeFile(textFile, content, 'utf8');
    const stderr = await runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, '-TextFile', textFile, '-OutFile', outFile, '-Voice', String(options.voice || '').trim()],
      SYNTH_TIMEOUT_MS,
    );
    const buffer = await readFile(outFile).catch(() => null);
    if (!buffer || !buffer.byteLength) throw new Error('系统语音合成没有生成音频文件。');
    const voice = /VOICE:([^\r\n]+)/.exec(stderr)?.[1]?.trim();
    return { buffer, contentType: 'audio/wav', ...(voice ? { voice } : {}) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function synthesizeOnMac(content: string, options: { voice?: string }): Promise<OfflineSpeechAudio> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sanmao-offline-voice-'));
  try {
    const aiffFile = path.join(directory, 'line.aiff');
    const wavFile = path.join(directory, 'line.wav');
    const requested = String(options.voice || '').trim();
    const speak = async (voice: string) => {
      const name = voice || await macChineseVoice();
      const args = ['-o', aiffFile, '--data-format=LEI16@22050'];
      if (name) args.push('-v', name);
      args.push('--', content);
      await runCommand('say', args, SYNTH_TIMEOUT_MS);
      return name;
    };
    let voice = requested;
    try {
      voice = await speak(requested);
    } catch (error) {
      // 用户填的很可能是别的平台的音色名（如 OpenAI 的 nova）：退回中文音色再来一次，而不是整句变无声。
      if (!requested) throw error;
      voice = await speak('');
    }
    await runCommand('afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', aiffFile, wavFile], SYNTH_TIMEOUT_MS);
    const buffer = await readFile(wavFile).catch(() => null);
    if (!buffer || !buffer.byteLength) throw new Error('系统语音合成没有生成音频文件。');
    return { buffer, contentType: 'audio/wav', ...(voice ? { voice } : {}) };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 合成一句配音，返回 wav 字节与实际音色；调用方负责落盘与测时长（与在线 TTS 同一套返回结构）。 */
export async function synthesizeOfflineSpeech(text: string, options: { voice?: string } = {}): Promise<OfflineSpeechAudio> {
  const content = String(text || '').trim();
  if (!content) throw new Error('配音文本为空。');
  if (process.platform === 'win32') return await synthesizeOnWindows(content, options);
  if (process.platform === 'darwin') return await synthesizeOnMac(content, options);
  throw new Error('本机离线配音只支持 Windows 与 macOS。');
}
