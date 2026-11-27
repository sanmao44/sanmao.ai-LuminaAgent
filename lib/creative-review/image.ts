import sharp from 'sharp';
import { constants } from 'node:fs';
import { lstat, open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { CreativeReviewEvidence, CreativeReviewReport, CreativeReviewSection, CreativeReviewStatus } from '@/packages/contracts/creative-review';
import type { CreativeVisualReviewer } from '@/packages/contracts/creative-review-visual';
import { resolveImageStoragePath } from '../image-storage';
import { reviewCreativeBrief } from './visual-evidence';

const MAX_REVIEW_BYTES = 100 * 1024 * 1024;
const ASPECT_TOLERANCE = 0.02;
const STORED_IMAGE_REF = /^\/api\/storage\/file\?name=([0-9A-Za-z._-]+\.(?:png|jpe?g|webp|gif|bmp|svg))$/i;

function section(evidence: CreativeReviewEvidence[]): CreativeReviewSection {
  const status: CreativeReviewStatus = evidence.some((item) => item.status === 'fail')
    ? 'fail'
    : evidence.some((item) => item.status === 'unknown') ? 'unknown' : 'pass';
  return { status, evidence };
}

function expectedRatio(value: string | undefined) {
  const match = String(value || '').match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : null;
}

function makeUnavailableReport(ref: string, reason: string, capabilityStatus: CreativeReviewStatus = 'unknown'): CreativeReviewReport {
  return {
    version: 'p1',
    mediaKind: 'image',
    artifactRef: STORED_IMAGE_REF.test(ref) ? ref : 'unavailable',
    checkedAt: new Date().toISOString(),
    capability: section([{
      dimension: 'local_artifact_read',
      status: capabilityStatus,
      criterion: '产物必须能从本地图片库安全读取后才能检查',
      reason,
      source: 'rule',
    }]),
    safety: section([{
      dimension: 'content_safety',
      status: 'unknown',
      criterion: '需要已校准的内容安全评审器',
      reason: '当前没有已校准的本地内容安全评审器；不能据此确认安全。',
      source: 'vision',
    }]),
  };
}

/** Inspect only a locally persisted image returned by the trusted image-storage adapter. */
async function reviewImageArtifactUncaught(input: {
  artifactRef: string;
  expectedAspectRatio?: string;
  storagePath?: string;
  brief?: string;
  generationPrompt?: string;
  visualReviewer?: CreativeVisualReviewer;
  signal?: AbortSignal;
}): Promise<CreativeReviewReport> {
  const ref = String(input.artifactRef || '').trim();
  if (!STORED_IMAGE_REF.test(ref)) {
    return makeUnavailableReport(ref, '评审拒绝非本地或格式不受支持的图片引用；不会请求外部 URL 或读取任意路径。', 'fail');
  }

  const artifactName = ref.match(STORED_IMAGE_REF)?.[1];
  if (!artifactName) return makeUnavailableReport(ref, '本地图片引用格式无法识别。', 'fail');
  const root = resolveImageStoragePath(input.storagePath);
  let bytes: Buffer | null = null;
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const realRoot = await realpath(root);
    const candidate = path.join(realRoot, artifactName);
    // Pin the opened file first, then verify that the authorized path still
    // resolves to that exact file. This also fails closed where O_NOFOLLOW is
    // unavailable, including Windows.
    fileHandle = await open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const before = await fileHandle.stat();
    if (!before.isFile()) return makeUnavailableReport(ref, '本地图片不是普通文件，评审已拒绝读取。', 'fail');
    const [linkInfo, realFile] = await Promise.all([lstat(candidate), realpath(candidate)]);
    const relative = path.relative(realRoot, realFile);
    if (linkInfo.isSymbolicLink() || !relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
      return makeUnavailableReport(ref, '本地图片解析到了授权存储目录之外；评审已拒绝读取。', 'fail');
    }
    const resolvedInfo = await stat(realFile);
    if (!before.ino || !resolvedInfo.ino || before.dev !== resolvedInfo.dev || before.ino !== resolvedInfo.ino) {
      return makeUnavailableReport(ref, '打开期间图片路径发生变化或文件身份无法验证；评审已拒绝读取。', 'fail');
    }
    if (before.size > MAX_REVIEW_BYTES) {
      return makeUnavailableReport(ref, `图片大小 ${before.size} 字节，超过 ${MAX_REVIEW_BYTES} 字节检查上限。`);
    }
    bytes = Buffer.alloc(before.size);
    const { bytesRead } = await fileHandle.read(bytes, 0, before.size, 0);
    const after = await fileHandle.stat();
    if (bytesRead !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      return makeUnavailableReport(ref, '读取期间本地图片发生变化，无法确认评审对应的文件版本。');
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    const accessRejected = code === 'ELOOP';
    return makeUnavailableReport(ref, accessRejected ? '图片路径触发符号链接保护，评审已拒绝访问。' : '图片无法从当前授权存储目录读取，无法完成文件检查。', accessRejected ? 'fail' : 'unknown');
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
  if (!bytes) return makeUnavailableReport(ref, '本地图片当前不可读取，无法完成文件检查。');
  if (!bytes.length || bytes.length > MAX_REVIEW_BYTES) {
    return makeUnavailableReport(ref, `图片大小 ${bytes.length} 字节不在 1–${MAX_REVIEW_BYTES} 字节检查范围内。`);
  }

  let metadata: sharp.Metadata;
  try {
    const decodeOptions = { limitInputPixels: 100_000_000, failOn: 'warning' as const };
    metadata = await sharp(bytes, decodeOptions).metadata();
    // metadata() parses headers only. stats() runs the pixel decode so files
    // with a valid header but truncated image data cannot pass this check.
    await sharp(bytes, decodeOptions).stats();
  } catch {
    return {
      version: 'p1',
      mediaKind: 'image',
      artifactRef: ref,
      checkedAt: new Date().toISOString(),
      capability: section([{
        dimension: 'image_decode', status: 'fail', criterion: 'sharp 必须解析图片元数据并完成像素解码',
        observed: false, expected: true, reason: '图片字节存在，但解码器无法识别该图片。', source: 'rule',
      }]),
      safety: section([{
        dimension: 'content_safety', status: 'unknown', criterion: '需要已校准的内容安全评审器',
        reason: '图片无法解码，无法检查其可见内容；不能据此确认安全。', source: 'vision',
      }]),
    };
  }

  const width = Number(metadata.width) || 0;
  const height = Number(metadata.height) || 0;
  const swapsDisplayDimensions = [5, 6, 7, 8].includes(Number(metadata.orientation));
  const displayWidth = swapsDisplayDimensions ? height : width;
  const displayHeight = swapsDisplayDimensions ? width : height;
  const actualRatio = displayWidth > 0 && displayHeight > 0 ? displayWidth / displayHeight : 0;
  const ratio = expectedRatio(input.expectedAspectRatio);
  const briefEvidence = await reviewCreativeBrief({
    mediaKind: 'image',
    dimension: 'brief_visual_compliance',
    brief: input.brief,
    generationPrompt: input.generationPrompt,
    visualReviewer: input.visualReviewer,
    signal: input.signal,
    loadFrames: async () => {
      const frame = await sharp(bytes!, { limitInputPixels: 100_000_000, failOn: 'warning' })
        .rotate()
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer();
      return [{ dataUrl: 'data:image/jpeg;base64,' + frame.toString('base64'), location: '整张图片' }];
    },
  });

  const capabilityEvidence: CreativeReviewEvidence[] = [
    {
      dimension: 'image_decode', status: 'pass', criterion: 'sharp 必须解析图片元数据并完成像素解码',
      observed: `${metadata.format || 'unknown'} ${width}×${height}`, expected: '可识别的图片格式与非零尺寸',
      reason: `已解码为 ${metadata.format || '未知格式'}，尺寸 ${width}×${height}。`, source: 'rule',
    },
    {
      dimension: 'pixel_dimensions', status: width > 0 && height > 0 ? 'pass' : 'fail',
      criterion: '宽度和高度均大于 0', observed: `${width}×${height}`, expected: 'width > 0 且 height > 0',
      reason: width > 0 && height > 0 ? `实测宽 ${width} px、高 ${height} px。` : '图片的宽度或高度为零，无法交付。', source: 'rule',
    },
    ratio ? {
      dimension: 'requested_aspect_ratio',
      status: actualRatio > 0 && Math.abs(actualRatio - ratio) / ratio <= ASPECT_TOLERANCE ? 'pass' : 'fail',
      criterion: `与需求比例的相对误差不超过 ${ASPECT_TOLERANCE * 100}%`,
      observed: actualRatio ? `${displayWidth}:${displayHeight} (${actualRatio.toFixed(4)}:1)${swapsDisplayDimensions ? `；已应用 EXIF 方向 ${metadata.orientation}` : ''}` : '不可测量',
      expected: `${input.expectedAspectRatio} (${ratio.toFixed(4)}:1)`,
      reason: actualRatio > 0 && Math.abs(actualRatio - ratio) / ratio <= ASPECT_TOLERANCE
        ? `按显示方向实测比例 ${actualRatio.toFixed(4)}:1，符合目标比例 ${input.expectedAspectRatio} 的容差。`
        : `按显示方向实测比例 ${actualRatio.toFixed(4)}:1，与目标比例 ${input.expectedAspectRatio} 相差超过容差。`,
      source: 'rule',
    } : {
      dimension: 'requested_aspect_ratio', status: 'unknown', criterion: '仅在需求给出明确宽高比时校验',
      observed: actualRatio ? `${displayWidth}:${displayHeight} (${actualRatio.toFixed(4)}:1)${swapsDisplayDimensions ? `；已应用 EXIF 方向 ${metadata.orientation}` : ''}` : '不可测量',
      reason: '本轮没有可解析的明确目标比例；不擅自推断商品图构图要求。', source: 'rule',
    },
    briefEvidence,
    {
      dimension: 'visual_quality', status: 'unknown', criterion: '清晰度、主体完整性与视觉质量',
      reason: '没有可验证的质量模型与标注样本阈值；为避免误伤合格作品，不以未经校准的像素启发式判定。', source: 'embedding',
    },
  ];

  return {
    version: 'p1', mediaKind: 'image', artifactRef: ref, checkedAt: new Date().toISOString(),
    capability: section(capabilityEvidence),
    safety: section([{
      dimension: 'content_safety', status: 'unknown', criterion: '需要已校准的内容安全评审器',
      reason: '本地文件和比例检查不分析画面语义；当前不能确认图片安全。', source: 'vision',
    }]),
  };
}

export async function reviewImageArtifact(input: {
  artifactRef: string;
  expectedAspectRatio?: string;
  storagePath?: string;
  brief?: string;
  generationPrompt?: string;
  visualReviewer?: CreativeVisualReviewer;
  signal?: AbortSignal;
}): Promise<CreativeReviewReport> {
  try {
    return await reviewImageArtifactUncaught(input);
  } catch {
    return makeUnavailableReport(String(input.artifactRef || '').trim(), '评审器未能完成本地检查；产物仍然保留，但本次结论为 unknown。');
  }
}