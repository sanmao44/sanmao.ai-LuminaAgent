import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  CreativeReviewEvidence,
  CreativeReviewReport,
  CreativeReviewSection,
  CreativeReviewStatus,
} from '@/packages/contracts/creative-review';
import type { CreativeVisualReviewer } from '@/packages/contracts/creative-review-visual';
import {
  buildVideoSignalEvidence,
  isVideoSignalFilterSetupError,
  VIDEO_SIGNAL_DIAGNOSTIC_FILTERS,
} from './video-signal-diagnostics';
import { reviewCreativeBrief } from './visual-evidence';

const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 30_000;
const STDERR_LIMIT_BYTES = 48 * 1024;
const STDOUT_LIMIT_BYTES = 16 * 1024;
const ASPECT_TOLERANCE = 0.02;
const STORED_VIDEO_REF = /^\/api\/storage\/video\?name=([0-9A-Za-z._-]+\.(?:mp4|webm|mov|ogv|m4v))$/i;

type ReviewVideoBufferInput = {
  bytes: Uint8Array;
  artifactRef: string;
  brief?: string;
  generationPrompt?: string;
  visualReviewer?: CreativeVisualReviewer;
  signal?: AbortSignal;
  expectedAspectRatio?: string;
  expectedDurationSeconds?: number;
  ffmpegPath: string;
};

type ReviewStoredVideoInput = {
  /** Opaque task-and-output identity; never a filesystem path. */
  artifactRef: string;
  /** Local storage URL returned by persistGeneratedVideos, never model input. */
  storedRef: string;
  storagePath: string;
  brief?: string;
  generationPrompt?: string;
  visualReviewer?: CreativeVisualReviewer;
  signal?: AbortSignal;
  expectedAspectRatio?: string;
  expectedDurationSeconds?: number;
  ffmpegPath: string;
};

type FfmpegResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  stderrTruncated: boolean;
  timedOut: boolean;
  spawnError: boolean;
  inputError: boolean;
};

type VideoReviewFrame = { dataUrl: string; location: string };

const MAX_REVIEW_FRAME_COUNT = 3;
const MAX_REVIEW_FRAME_OUTPUT_BYTES = 1024 * 1024;
const MAX_REVIEW_FRAME_BYTES = 512 * 1024;
const MAX_REVIEW_FRAME_EDGE = 512;

function boundedAppend(previous: string, chunk: string, limit: number) {
  const combined = `${previous}${chunk}`;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

function section(evidence: CreativeReviewEvidence[]): CreativeReviewSection {
  const status: CreativeReviewStatus = evidence.some((item) => item.status === 'fail')
    ? 'fail'
    : evidence.some((item) => item.status === 'unknown') ? 'unknown' : 'pass';
  return { status, evidence };
}

function normalizeArtifactRef(value: unknown) {
  const ref = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{1,128}$/.test(ref) ? ref : 'unavailable';
}

function makeReport(
  artifactRef: string,
  capabilityEvidence: CreativeReviewEvidence[],
  safetyReason: string,
): CreativeReviewReport {
  return {
    version: 'p1',
    mediaKind: 'video',
    artifactRef,
    checkedAt: new Date().toISOString(),
    capability: section(capabilityEvidence),
    safety: section([{
      dimension: 'content_safety',
      status: 'unknown',
      criterion: '需要已校准的内容安全评审器',
      reason: safetyReason,
      source: 'vision',
    }]),
  };
}

function unknownReport(artifactRef: string, dimension: string, reason: string, criterion: string) {
  return makeReport(artifactRef, [{
    dimension,
    status: 'unknown',
    criterion,
    reason,
    source: 'rule',
  }], '视频结构检查未能完成，无法确认画面内容安全。');
}

function parseExpectedRatio(value: string | undefined) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function parseDeclaredDuration(stderr: string) {
  const match = /\bDuration:\s*(\d{1,4}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function parseDecodedDuration(stdout: string) {
  const matches = [...stdout.matchAll(/^out_time_us=(\d+)\s*$/gmu)];
  const value = Number(matches.at(-1)?.[1]);
  return Number.isFinite(value) && value > 0 ? value / 1_000_000 : null;
}

type VideoStreamInfo = {
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  displayAspectRatio: number | null;
  displayAspectObserved: string;
  ratioUnknownReason?: string;
};

function parseVideoStreamInfo(stderr: string): VideoStreamInfo | null {
  const lines = stderr.split(/\r?\n/u);
  const videoLineIndex = lines.findIndex((item) => /\bVideo:/u.test(item));
  if (videoLineIndex < 0) return null;
  const nextStreamIndex = lines.findIndex((item, index) => index > videoLineIndex && /^\s*Stream #\d+:\d+:/u.test(item));
  const streamLog = lines.slice(videoLineIndex, nextStreamIndex < 0 ? undefined : nextStreamIndex).join('\n');
  const dimensions = lines[videoLineIndex].match(/(?:^|\s)(\d{2,5})x(\d{2,5})(?=\s|\[|,|$)/u);
  if (!dimensions) return null;
  const width = Number(dimensions[1]);
  const height = Number(dimensions[2]);
  if (!(width > 0 && height > 0)) return null;

  const darMatch = /\bDAR\s+(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/u.exec(streamLog);
  const sarMatch = /\bSAR\s+(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)/u.exec(streamLog);
  const parseRatio = (match: RegExpExecArray | null) => {
    if (!match) return null;
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    return numerator > 0 && denominator > 0 ? numerator / denominator : null;
  };
  const sampleAspectRatio = parseRatio(sarMatch);
  const encodedAspectRatio = width / height;
  const displayAspectRatio = parseRatio(darMatch) ?? (sampleAspectRatio ? encodedAspectRatio * sampleAspectRatio : encodedAspectRatio);

  const hasDisplayMatrix = /display\s*matrix/iu.test(streamLog);
  const rotationMatch = /rotation of\s*(-?\d+(?:\.\d+)?)\s*degrees/iu.exec(streamLog);
  let ratioUnknownReason: string | undefined;
  let rotationDegrees: number | null = hasDisplayMatrix ? null : 0;
  if (hasDisplayMatrix) {
    if (!rotationMatch) {
      ratioUnknownReason = '视频声明了显示矩阵，但 FFmpeg 未提供可解析的旋转角度。';
    } else {
      const rawRotation = Number(rotationMatch[1]);
      const normalizedRotation = ((rawRotation % 360) + 360) % 360;
      const rightAngle = [0, 90, 180, 270].find((angle) => Math.abs(normalizedRotation - angle) <= 0.1);
      if (rightAngle === undefined) {
        ratioUnknownReason = '视频包含非直角显示旋转；当前评审器不能可靠计算旋转后的显示比例。';
      } else {
        rotationDegrees = rightAngle;
      }
    }
  }

  const swapsDisplayDimensions = rotationDegrees === 90 || rotationDegrees === 270;
  const measuredDisplayAspectRatio = ratioUnknownReason
    ? null
    : swapsDisplayDimensions ? 1 / displayAspectRatio : displayAspectRatio;
  const displayWidth = swapsDisplayDimensions ? height : width;
  const displayHeight = swapsDisplayDimensions ? width : height;
  const ratioSource = darMatch
    ? 'DAR ' + darMatch[1] + ':' + darMatch[2]
    : sarMatch ? 'SAR ' + sarMatch[1] + ':' + sarMatch[2] + ' × ' + width + ':' + height : width + ':' + height;
  const rotationEvidence = rotationDegrees && rotationDegrees !== 0 ? '；rotation ' + rotationDegrees + '°' : '';
  const displayAspectObserved = measuredDisplayAspectRatio
    ? ratioSource + rotationEvidence + ' (' + measuredDisplayAspectRatio.toFixed(4) + ':1)'
    : ratioSource + rotationEvidence + '；无法可靠计算显示比例';

  return {
    width, height, displayWidth, displayHeight,
    displayAspectRatio: measuredDisplayAspectRatio,
    displayAspectObserved,
    ...(ratioUnknownReason ? { ratioUnknownReason } : {}),
  };
}

function runFfmpeg(ffmpegPath: string, input: Uint8Array, videoFilter?: string): Promise<FfmpegResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let stderrTruncated = false;
    let settled = false;
    let timedOut = false;
    let spawnError = false;
    let inputError = false;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(ffmpegPath, [
        '-hide_banner',
        '-nostats',
        '-loglevel', 'info',
        '-xerror',
        '-err_detect', 'explode',
        '-protocol_whitelist', 'pipe',
        '-i', 'pipe:0',
        '-map', '0:v:0',
        '-an', '-sn', '-dn',
        ...(videoFilter ? ['-vf', videoFilter] : []),
        '-progress', 'pipe:1',
        '-f', 'null', '-'
      ], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ code: null, stdout, stderr, stderrTruncated, timedOut, spawnError: true, inputError });
      return;
    }

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, stderrTruncated, timedOut, spawnError, inputError });
    };
    timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch { /* The child may already have exited. */ }
    }, PROCESS_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout = boundedAppend(stdout, chunk, STDOUT_LIMIT_BYTES); });
    child.stderr.on('data', (chunk: string) => {
      if (stderr.length + chunk.length > STDERR_LIMIT_BYTES) stderrTruncated = true;
      stderr = boundedAppend(stderr, chunk, STDERR_LIMIT_BYTES);
    });
    child.once('error', () => {
      spawnError = true;
    });
    child.stdin.once('error', () => { inputError = true; });
    child.once('close', (code: number | null) => finish(code));
    child.stdin.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  });
}

function splitJpegFrames(output: Buffer, stderr: string): VideoReviewFrame[] {
  const frames: VideoReviewFrame[] = [];
  const times = [...stderr.matchAll(/pts_time:\s*(-?\d+(?:\.\d+)?)/gu)]
    .map((match) => Number(match[1]))
    .filter((time) => Number.isFinite(time) && time >= 0);
  let start = -1;
  for (let index = 0; index + 1 < output.length && frames.length < MAX_REVIEW_FRAME_COUNT; index += 1) {
    if (start < 0 && output[index] === 0xff && output[index + 1] === 0xd8) {
      start = index;
      index += 1;
      continue;
    }
    if (start >= 0 && output[index] === 0xff && output[index + 1] === 0xd9) {
      const jpeg = output.subarray(start, index + 2);
      if (jpeg.length <= MAX_REVIEW_FRAME_BYTES) {
        const frameIndex = frames.length;
        const time = times[frameIndex];
        frames.push({
          dataUrl: 'data:image/jpeg;base64,' + jpeg.toString('base64'),
          location: Number.isFinite(time) ? '约 ' + time.toFixed(3) + ' 秒' : '第 ' + (frameIndex + 1) + ' 个抽样画面（时间戳不可用）',
        });
      }
      start = -1;
      index += 1;
    }
  }
  return frames;
}

/** Extract at most three low-resolution JPEG samples from the exact validated input bytes. */
function runFfmpegReviewFrames(
  ffmpegPath: string,
  input: Uint8Array,
  durationSeconds: number | null | undefined,
  signal?: AbortSignal,
): Promise<VideoReviewFrame[]> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve([]);
    let output = Buffer.alloc(0);
    let stderr = '';
    let settled = false;
    let outputLimited = false;
    let timer: NodeJS.Timeout | undefined;
    let child: ChildProcessWithoutNullStreams;
    const interval = Number.isFinite(durationSeconds) && Number(durationSeconds) > 0
      ? Math.max(0.15, Number(durationSeconds) * 0.45)
      : 1.5;
    const filters = 'select=isnan(prev_selected_t)+gte(t-prev_selected_t\\,' + interval.toFixed(3)
      + '),scale=' + MAX_REVIEW_FRAME_EDGE + ':' + MAX_REVIEW_FRAME_EDGE
      + ':force_original_aspect_ratio=decrease,showinfo';
    try {
      child = spawn(ffmpegPath, [
        '-hide_banner', '-nostats', '-loglevel', 'info', '-xerror', '-err_detect', 'explode',
        '-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-map', '0:v:0',
        '-an', '-sn', '-dn', '-vf', filters, '-fps_mode', 'vfr',
        '-frames:v', String(MAX_REVIEW_FRAME_COUNT), '-c:v', 'mjpeg', '-q:v', '8',
        '-f', 'image2pipe', 'pipe:1',
      ], { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch {
      resolve([]);
      return;
    }

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve(splitJpegFrames(output, stderr));
    };
    const abort = () => {
      try { child.kill('SIGKILL'); } catch { /* The process may already have exited. */ }
    };
    timer = setTimeout(abort, PROCESS_TIMEOUT_MS);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      if (outputLimited) return;
      const remaining = MAX_REVIEW_FRAME_OUTPUT_BYTES - output.length;
      if (chunk.length > remaining) {
        if (remaining > 0) output = Buffer.concat([output, chunk.subarray(0, remaining)]);
        outputLimited = true;
        abort();
        return;
      }
      output = Buffer.concat([output, chunk]);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { stderr = boundedAppend(stderr, chunk, STDERR_LIMIT_BYTES); });
    child.once('error', () => finish());
    child.once('close', () => finish());
    child.stdin.end(Buffer.from(input.buffer, input.byteOffset, input.byteLength));
  });
}

/** Resolve and read only the flat local reference returned by video storage. */
export async function reviewStoredVideoArtifact(input: ReviewStoredVideoInput): Promise<CreativeReviewReport> {
  const artifactRef = normalizeArtifactRef(input.artifactRef);
  const match = String(input.storedRef || '').trim().match(STORED_VIDEO_REF);
  if (!match) {
    return unknownReport(artifactRef, 'local_artifact_access', '视频未在当前本地媒体库中落盘；不会为评审请求远程 URL 或任意路径。', '仅评审视频存储适配器返回的本地媒体库引用');
  }

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const root = await realpath(path.resolve(input.storagePath));
    const candidate = path.join(root, match[1]);
    // Pin the opened file first, then verify that the authorized path still
    // resolves to that exact file. This also fails closed where O_NOFOLLOW is
    // unavailable, including Windows.
    handle = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await handle.stat();
    if (!before.isFile()) {
      return makeReport(artifactRef, [{
        dimension: 'local_artifact_access', status: 'fail',
        criterion: '评审文件必须是授权视频目录内的普通文件',
        observed: '非普通文件', expected: '普通文件', reason: '视频引用不是普通文件；评审已拒绝读取。', source: 'rule',
      }], '访问边界拒绝了文件读取；视频语义安全仍无法确认。');
    }
    const [entry, realFile] = await Promise.all([lstat(candidate), realpath(candidate)]);
    const relative = path.relative(root, realFile);
    if (entry.isSymbolicLink() || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return makeReport(artifactRef, [{
        dimension: 'local_artifact_access', status: 'fail',
        criterion: '评审文件必须是授权视频目录内的普通文件',
        observed: '路径不符合本地媒体库边界', expected: '授权根目录内的常规文件',
        reason: '视频引用指向目录外或非普通文件；评审已拒绝读取。', source: 'rule',
      }], '访问边界拒绝了文件读取；视频语义安全仍无法确认。');
    }
    const resolvedInfo = await stat(realFile);
    if (!before.ino || !resolvedInfo.ino || before.dev !== resolvedInfo.dev || before.ino !== resolvedInfo.ino) {
      return makeReport(artifactRef, [{
        dimension: 'local_artifact_access', status: 'fail',
        criterion: '打开的文件身份必须与授权视频路径一致',
        observed: '路径变化或身份未知', expected: '同一普通文件',
        reason: '打开期间视频路径发生变化或文件身份无法验证；评审已拒绝读取。', source: 'rule',
      }], '访问边界拒绝了文件读取；视频语义安全仍无法确认。');
    }
    if (before.size > MAX_VIDEO_BYTES) {
      return unknownReport(artifactRef, 'video_size', `视频大小 ${before.size} 字节，超过 ${MAX_VIDEO_BYTES} 字节的本地检查上限。`, `视频不超过 ${MAX_VIDEO_BYTES} 字节`);
    }
    const bytes = Buffer.alloc(before.size);
    const { bytesRead } = await handle.read(bytes, 0, before.size, 0);
    const after = await handle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      return unknownReport(artifactRef, 'local_artifact_read', '读取期间本地视频发生变化，无法确认评审对应的文件版本。', '评审读取期间的文件字节应保持稳定');
    }
    return reviewVideoBuffer({
      bytes,
      artifactRef,
      brief: input.brief,
      generationPrompt: input.generationPrompt,
      visualReviewer: input.visualReviewer,
      signal: input.signal,
      expectedAspectRatio: input.expectedAspectRatio,
      expectedDurationSeconds: input.expectedDurationSeconds,
      ffmpegPath: input.ffmpegPath,
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const accessRejected = code === 'ELOOP';
    return accessRejected
      ? makeReport(artifactRef, [{
        dimension: 'local_artifact_access', status: 'fail',
        criterion: '评审文件必须位于授权视频目录内且不能经过符号链接',
        observed: '符号链接拒绝', expected: '授权目录内的普通文件',
        reason: '视频路径触发符号链接保护；评审已拒绝读取。', source: 'rule',
      }], '访问边界拒绝了文件读取；视频语义安全仍无法确认。')
      : unknownReport(artifactRef, 'local_artifact_read', '视频当前无法从授权存储目录读取；不能确认评审结果。', '本地视频文件必须可读取');
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Review authorized video bytes using only a caller-injected FFmpeg executable.
 * This function accepts bytes rather than a path or URL and never passes
 * user-controlled arguments to a shell. FFmpeg reads only its stdin pipe;
 * nested file and network protocols are not available to media demuxers.
 */
export async function reviewVideoBuffer(input: ReviewVideoBufferInput): Promise<CreativeReviewReport> {
  const artifactRef = normalizeArtifactRef(input.artifactRef);
  const bytes = input.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    return makeReport(artifactRef, [{
      dimension: 'video_input', status: 'fail', criterion: '视频产物必须包含非空字节',
      observed: bytes instanceof Uint8Array ? bytes.byteLength : 'invalid', expected: '1 byte or more',
      reason: '没有可供检查的视频字节。', source: 'rule',
    }], '没有可检查的视频画面，无法确认内容安全。');
  }
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    return unknownReport(artifactRef, 'video_size', `视频为 ${bytes.byteLength} 字节，超过 ${MAX_VIDEO_BYTES} 字节的本地检查上限。`, `视频不超过 ${MAX_VIDEO_BYTES} 字节`);
  }
  if (typeof input.ffmpegPath !== 'string' || !input.ffmpegPath.trim()) {
    return unknownReport(artifactRef, 'video_decoder', '没有可用的本地 FFmpeg 执行文件，无法检查视频。', '本地 FFmpeg 必须可运行并完整解码主视频流');
  }

  try {
    let signalDiagnosticsUnavailableReason = '';
    let result = await runFfmpeg(input.ffmpegPath, bytes, VIDEO_SIGNAL_DIAGNOSTIC_FILTERS);
    if (result.code !== 0 && !result.timedOut && isVideoSignalFilterSetupError(result.stderr)) {
      signalDiagnosticsUnavailableReason = '当前本地 FFmpeg 不支持黑帧或静止画面检测器；已改用原始完整解码结果，候选提示保持 unknown。';
      result = await runFfmpeg(input.ffmpegPath, bytes);
    }
    if (result.spawnError) {
      return unknownReport(artifactRef, 'video_decoder', '本地 FFmpeg 无法启动，视频未被判定为通过或失败。', '本地 FFmpeg 必须可运行并完整解码主视频流');
    }
    if (result.timedOut) {
      return unknownReport(artifactRef, 'video_decode', `主视频流解码超过 ${PROCESS_TIMEOUT_MS / 1000} 秒时限，结果未确认。`, '本地 FFmpeg 必须在时限内完整解码主视频流');
    }
    if (result.inputError && result.code === 0) {
      return unknownReport(artifactRef, 'video_input', '视频字节未能完整传送给 FFmpeg，解码结果未确认。', '全部输入字节必须传送并完整解码');
    }

    const decodeSucceeded = result.code === 0;
    const videoInfo = parseVideoStreamInfo(result.stderr);
    const dimensions = videoInfo ? { width: videoInfo.width, height: videoInfo.height } : null;
    const decodedDuration = decodeSucceeded ? parseDecodedDuration(result.stdout) : null;
    const declaredDuration = parseDeclaredDuration(result.stderr);
    const durationSeconds = decodedDuration || declaredDuration;
    const durationSource = decodedDuration ? 'decoded timeline' : declaredDuration ? 'container metadata' : '';
    const failureStatus: CreativeReviewStatus = decodeSucceeded ? 'pass' : 'fail';
    const diagnostic = result.stderr
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(-240);
    const evidence: CreativeReviewEvidence[] = [{
      dimension: 'video_decode',
      status: failureStatus,
      criterion: 'FFmpeg 必须在时限内完整解码主视频流',
      observed: decodeSucceeded ? '完整解码成功' : `FFmpeg exit ${result.code ?? 'unknown'}`,
      expected: '完整解码成功',
      reason: decodeSucceeded
        ? 'FFmpeg 已遍历并解码主视频流至结尾。'
        : `主视频流解码失败${diagnostic ? `：${diagnostic}` : '，文件损坏、格式不支持或缺少视频流。'}`,
      source: 'rule',
    }];

    evidence.push(dimensions ? {
      dimension: 'video_dimensions',
      status: 'pass', criterion: 'FFmpeg 必须报告主视频流的非零宽高',
      observed: videoInfo && (videoInfo.displayWidth !== dimensions.width || videoInfo.displayHeight !== dimensions.height)
        ? `编码 ${dimensions.width}×${dimensions.height}；显示 ${videoInfo.displayWidth}×${videoInfo.displayHeight}`
        : `${dimensions.width}×${dimensions.height}`,
      expected: 'width > 0 且 height > 0',
      reason: videoInfo && (videoInfo.displayWidth !== dimensions.width || videoInfo.displayHeight !== dimensions.height)
        ? `主视频流编码尺寸为 ${dimensions.width}×${dimensions.height} 像素，按旋转矩阵显示为 ${videoInfo.displayWidth}×${videoInfo.displayHeight}。`
        : `主视频流实测尺寸为 ${dimensions.width}×${dimensions.height} 像素。`,
      source: 'rule',
    } : {
      dimension: 'video_dimensions',
      status: 'unknown',
      criterion: 'FFmpeg 必须报告主视频流的非零宽高',
      reason: 'FFmpeg 未能提供可解析的主视频流尺寸，因此不能确认尺寸检查结果。',
      source: 'rule',
    });

    evidence.push(durationSeconds ? {
      dimension: 'video_duration',
      status: 'pass', criterion: '视频时长必须可测量且大于 0 秒',
      observed: `${durationSeconds.toFixed(3)} s (${durationSource})`,
      expected: 'duration > 0 s',
      reason: `视频时长实测约 ${durationSeconds.toFixed(3)} 秒${durationSource === 'container metadata' ? '（来自容器元数据；解码时间轴不可用）' : '（来自完整解码时间轴）'}。`,
      source: 'rule',
    } : {
      dimension: 'video_duration',
      status: 'unknown', criterion: '视频时长必须可测量且大于 0 秒',
      reason: 'FFmpeg 没有提供可解析的解码时长或容器时长。',
      source: 'rule',
    });

    const ratio = parseExpectedRatio(input.expectedAspectRatio);
    if (dimensions && ratio && videoInfo?.displayAspectRatio) {
      const actualRatio = videoInfo.displayAspectRatio;
      const relativeError = Math.abs(actualRatio - ratio) / ratio;
      evidence.push({
        dimension: 'requested_aspect_ratio',
        status: relativeError <= ASPECT_TOLERANCE ? 'pass' : 'fail',
        criterion: '与目标显示宽高比的相对误差不超过 ' + ASPECT_TOLERANCE * 100 + '%',
        observed: videoInfo.displayAspectObserved,
        expected: input.expectedAspectRatio + ' (' + ratio.toFixed(4) + ':1)',
        reason: relativeError <= ASPECT_TOLERANCE
          ? '显示比例 ' + actualRatio.toFixed(4) + ':1，符合目标 ' + input.expectedAspectRatio + ' 的容差。'
          : '显示比例 ' + actualRatio.toFixed(4) + ':1，与目标 ' + input.expectedAspectRatio + ' 的相对误差超过 ' + ASPECT_TOLERANCE * 100 + '%。',
        source: 'rule',
      });
    } else {
      evidence.push({
        dimension: 'requested_aspect_ratio', status: 'unknown',
        criterion: '仅在目标比例明确且显示比例可测量时校验画幅',
        observed: videoInfo?.displayAspectObserved ?? (dimensions ? dimensions.width + '×' + dimensions.height : '尺寸不可测量'),
        expected: input.expectedAspectRatio ? String(input.expectedAspectRatio).slice(0, 32) : '未提供目标比例',
        reason: !ratio
          ? '本次没有有效的明确目标比例；不擅自推断用户的画幅意图。'
          : videoInfo?.ratioUnknownReason ?? (dimensions ? 'FFmpeg 未能提供可解析的显示比例，因此无法确认目标画幅。' : '视频尺寸不可测量，因此无法计算目标画幅误差。'),
        source: 'rule',
      });
    }

    const expectedDuration = Number(input.expectedDurationSeconds);
    if (Number.isFinite(expectedDuration) && expectedDuration > 0 && durationSeconds) {
      const tolerance = Math.max(0.5, expectedDuration * 0.05);
      const delta = Math.abs(durationSeconds - expectedDuration);
      evidence.push({
        dimension: 'requested_duration',
        status: delta <= tolerance ? 'pass' : 'fail',
        criterion: '与目标时长的差不超过 ' + tolerance.toFixed(3) + ' 秒',
        observed: durationSeconds.toFixed(3) + ' s',
        expected: expectedDuration.toFixed(3) + ' s',
        reason: delta <= tolerance
          ? '实测时长与目标相差 ' + delta.toFixed(3) + ' 秒，在容差 ' + tolerance.toFixed(3) + ' 秒内。'
          : '实测时长与目标相差 ' + delta.toFixed(3) + ' 秒，超过容差 ' + tolerance.toFixed(3) + ' 秒。',
        source: 'rule',
      });
    } else {
      evidence.push({
        dimension: 'requested_duration', status: 'unknown',
        criterion: '仅在需求给出有效目标时长时校验',
        observed: durationSeconds ? durationSeconds.toFixed(3) + ' s' : '时长不可测量',
        expected: Number.isFinite(expectedDuration) && expectedDuration > 0 ? expectedDuration.toFixed(3) + ' s' : '未提供有效目标时长',
        reason: !Number.isFinite(expectedDuration) || expectedDuration <= 0
          ? '本次没有有效的目标时长；不擅自推断时长要求。'
          : '视频时长不可测量，因此无法比较目标时长。',
        source: 'rule',
      });
    }

    const visualEvidence = decodeSucceeded && dimensions
      ? await reviewCreativeBrief({
        mediaKind: 'video',
        dimension: 'brief_alignment',
        brief: input.brief,
        generationPrompt: input.generationPrompt,
        visualReviewer: input.visualReviewer,
        signal: input.signal,
        loadFrames: () => runFfmpegReviewFrames(input.ffmpegPath, bytes, durationSeconds, input.signal),
      })
      : {
        dimension: 'brief_alignment', status: 'unknown', criterion: '画面主体、构图、风格与创作需求一致',
        reason: '视频没有通过完整解码与尺寸检查；未提取画面或请求视觉评审。', source: 'vision',
      } satisfies CreativeReviewEvidence;

    evidence.push(
      ...buildVideoSignalEvidence({
        stderr: result.stderr,
        complete: decodeSucceeded && !result.spawnError && !result.timedOut && !result.inputError && !result.stderrTruncated,
        truncated: result.stderrTruncated,
        unavailableReason: signalDiagnosticsUnavailableReason,
      }),
      {
        dimension: 'subtitle_timeline', status: 'unknown',
        criterion: '嵌入或烧录字幕应位于有效视频时长内，并与画面/语音同步',
        reason: '本版本未提取嵌入字幕，也未识别烧录字幕；字幕时间轴和同步状态尚未评审。',
        source: 'rule',
      },
      visualEvidence,
    );

    return makeReport(
      artifactRef,
      evidence,
      '本次仅完成本地结构与解码检查，没有分析视频语义；不能确认画面内容安全。',
    );
  } catch {
    return unknownReport(artifactRef, 'video_review', '评审器未能完成本地视频检查；本次结论为 unknown。', '本地评审应在资源限制内完成并返回可复核证据');
  }
}
