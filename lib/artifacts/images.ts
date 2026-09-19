import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { getStorageRoots, resolveStoredFile } from '../image-storage';
import {
  ARTIFACT_IMAGE_MAX_COUNT,
  ARTIFACT_IMAGE_MAX_HEIGHT,
  ARTIFACT_IMAGE_MAX_SOURCE_BYTES,
  ARTIFACT_IMAGE_MAX_WIDTH,
} from './limits';

/** 模型的插图入参：ref 来自图片工具返回的引用，caption 可选。 */
export type ArtifactImageInput = {
  ref?: unknown;
  caption?: unknown;
};

export type ArtifactImage = {
  data: Buffer;
  type: 'jpg' | 'png' | 'gif' | 'bmp';
  width: number;
  height: number;
  caption: string;
};

export type LoadArtifactImagesOptions = {
  warnings: string[];
  context: string;
  /** 图片存储根目录；不传则按默认配置解析。 */
  roots?: readonly string[];
};

/** 交付物生成选项：插图从哪个目录解析（跟随应用设置的图片保存路径）。 */
export type ArtifactGenerateOptions = {
  imageRoots?: readonly string[];
};

/** 只接受单层文件名，杜绝 `..` 和子目录。 */
const STORED_NAME_PATTERN = /^[0-9A-Za-z._-]+\.(?:png|jpe?g|webp|gif|bmp)$/i;
const CAPTION_MAX_CHARS = 120;

/**
 * 只认本地已保存图片：`/api/storage/file?name=xxx`、同源绝对地址（同样只取 name 参数）
 * 或裸文件名。外部 http 地址一律拒绝——交付物构建过程中不联网。
 */
export function storedImageName(raw: unknown) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (STORED_NAME_PATTERN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value, 'http://sanmao.local');
  } catch {
    return '';
  }
  if (url.pathname !== '/api/storage/file') return '';
  const name = url.searchParams.get('name') || '';
  return STORED_NAME_PATTERN.test(name) ? name : '';
}

function resolveImageFile(roots: readonly string[], name: string) {
  const candidates = roots
    .map((root) => resolveStoredFile(root, name))
    .filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

/**
 * 统一成 docx / pptxgenjs 都能吃的位图：超宽或非通用格式才重编码，
 * 其余保持原字节，避免为了插图把图片体积再放大一轮。
 */
async function normalizeImage(buffer: Buffer): Promise<Omit<ArtifactImage, 'caption'> | null> {
  const meta = await sharp(buffer, { animated: false }).metadata().catch(() => null);
  const width = Number(meta?.width) || 0;
  const height = Number(meta?.height) || 0;
  if (!width || !height) return null;
  const format = String(meta?.format || '');
  const keepFormat = format === 'png' || format === 'jpeg' || format === 'gif' || format === 'bmp';
  const needsResize = width > ARTIFACT_IMAGE_MAX_WIDTH || height > ARTIFACT_IMAGE_MAX_HEIGHT;
  if (keepFormat && !needsResize) {
    return { data: buffer, type: format === 'jpeg' ? 'jpg' : (format as 'png' | 'gif' | 'bmp'), width, height };
  }
  const pipeline = sharp(buffer, { animated: false })
    .resize({ width: ARTIFACT_IMAGE_MAX_WIDTH, height: ARTIFACT_IMAGE_MAX_HEIGHT, fit: 'inside', withoutEnlargement: true });
  const resized = format === 'jpeg'
    ? await pipeline.jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true })
    : await pipeline.png().toBuffer({ resolveWithObject: true });
  return {
    data: resized.data,
    type: format === 'jpeg' ? 'jpg' : 'png',
    width: resized.info.width,
    height: resized.info.height,
  };
}

/**
 * 逐张解析插图。任何一张不可用都只记 warning 并跳过，不能让整份交付失败。
 */
export async function loadArtifactImages(inputs: unknown, options: LoadArtifactImagesOptions): Promise<ArtifactImage[]> {
  const list = (Array.isArray(inputs) ? inputs : [])
    .filter((item): item is ArtifactImageInput => Boolean(item) && typeof item === 'object');
  if (!list.length) return [];
  const roots = options.roots?.length ? options.roots : getStorageRoots();
  if (list.length > ARTIFACT_IMAGE_MAX_COUNT) {
    options.warnings.push(`${options.context}图片超过 ${ARTIFACT_IMAGE_MAX_COUNT} 张，已截断`);
  }
  const images: ArtifactImage[] = [];
  for (const [index, item] of list.slice(0, ARTIFACT_IMAGE_MAX_COUNT).entries()) {
    const label = `${options.context}第 ${index + 1} 张图片`;
    const name = storedImageName(item.ref);
    if (!name) {
      options.warnings.push(`${label}引用无效（只能用图片工具返回的 ref），已跳过`);
      continue;
    }
    const file = resolveImageFile(roots, name);
    if (!file) {
      options.warnings.push(`${label}已找不到本地文件，已跳过`);
      continue;
    }
    try {
      const info = await stat(file);
      if (info.size > ARTIFACT_IMAGE_MAX_SOURCE_BYTES) {
        options.warnings.push(`${label}超过 ${Math.round(ARTIFACT_IMAGE_MAX_SOURCE_BYTES / 1024 / 1024)}MB，已跳过`);
        continue;
      }
      const normalized = await normalizeImage(await readFile(file));
      if (!normalized) {
        options.warnings.push(`${label}不是可用的图片格式，已跳过`);
        continue;
      }
      const caption = String(item.caption ?? '').replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX_CHARS);
      images.push({ ...normalized, caption });
    } catch {
      options.warnings.push(`${label}读取失败，已跳过`);
    }
  }
  return images;
}
