/**
 * 本机离线配音：不联网、不消耗任何额度，用系统自带的语音合成引擎出声。
 *
 * 解决场景：用户一个 TTS 模型都没配时，「一键克隆出片」只能出「无声 + 字幕」。
 * 目前只覆盖 Windows（System.Speech 自带 Microsoft Huihui 中文音色）；
 * 其它平台返回不支持，继续走原来的降级链。
 *
 * 两个实测踩到的坑：
 * 1) 中文不能走命令行参数：PowerShell 的代码页会把中文转成乱码，必须写临时文件再读。
 * 2) 系统默认音色可能是英文（Zira / David）：不指定音色时优先挑 zh-* 音色，否则中文念不出来。
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SpeechAudio } from './speech';

export const OFFLINE_SPEECH_LABEL = '本机离线配音';
const SYNTH_TIMEOUT_MS = 60_000;
/** 纯 ASCII 脚本：PS 5.1 会按 ANSI 读 .ps1，中文写进去会变成乱码。 */
const SYNTH_SCRIPT = `param([string]$TextFile, [string]$OutFile, [string]$Voice)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if (-not $Voice) {
  $zh = $s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
  if ($zh) { $Voice = $zh.VoiceInfo.Name }
}
if ($Voice) { try { $s.SelectVoice($Voice) } catch { } }
$s.SetOutputToWaveFile($OutFile)
$s.Speak([IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8))
$s.Dispose()
`;

/** 只有 Windows 有这条零成本路径。 */
export function offlineSpeechSupported() {
  return process.platform === 'win32';
}

function runPowerShell(scriptFile: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 已经退出 */ }
      reject(new Error('本机离线配音超时，已终止。'));
    }, SYNTH_TIMEOUT_MS);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
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

/** 合成一句配音，返回 wav 字节；调用方负责落盘与测时长（与在线 TTS 同一套返回结构）。 */
export async function synthesizeOfflineSpeech(text: string, options: { voice?: string } = {}): Promise<SpeechAudio> {
  const content = String(text || '').trim();
  if (!content) throw new Error('配音文本为空。');
  if (!offlineSpeechSupported()) throw new Error('本机离线配音只支持 Windows。');
  const directory = await mkdtemp(path.join(tmpdir(), 'sanmao-offline-voice-'));
  try {
    const scriptFile = path.join(directory, 'speak.ps1');
    const textFile = path.join(directory, 'line.txt');
    const outFile = path.join(directory, 'line.wav');
    await writeFile(scriptFile, SYNTH_SCRIPT, 'utf8');
    await writeFile(textFile, content, 'utf8');
    await runPowerShell(scriptFile, ['-TextFile', textFile, '-OutFile', outFile, '-Voice', String(options.voice || '').trim()]);
    const buffer = await readFile(outFile).catch(() => null);
    if (!buffer || !buffer.byteLength) throw new Error('系统语音合成没有生成音频文件。');
    return { buffer, contentType: 'audio/wav' };
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
