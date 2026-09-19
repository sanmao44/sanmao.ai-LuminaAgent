/** Artifact 子系统的集中上限，避免模型一次塞进超大内容把服务打爆。 */
export const ARTIFACT_MAX_BYTES = 50 * 1024 * 1024;
export const ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
export const ARTIFACT_MAX_PER_TURN = 8;
export const ARCHIVE_MAX_ENTRIES = 64;
export const ARTIFACT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ARTIFACT_ROOT_MAX_BYTES = 512 * 1024 * 1024;

/** 在线预览只解析有限内容，避免超大文件把服务拖住。 */
export const PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
export const PREVIEW_MAX_SHEETS = 8;
export const PREVIEW_MAX_ROWS = 400;
export const PREVIEW_MAX_COLUMNS = 30;
export const PREVIEW_MAX_BLOCKS = 1200;
/** 预览内联的插图/图表上限：base64 会放大体积，媒体必须单独设限。 */
export const PREVIEW_MAX_IMAGES = 12;
export const PREVIEW_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const PREVIEW_MAX_IMAGE_TOTAL_BYTES = 12 * 1024 * 1024;
export const PREVIEW_MAX_CHARTS = 8;

export const DOCUMENT_MAX_SECTIONS = 200;
export const DOCUMENT_MAX_PARAGRAPHS_PER_SECTION = 300;
export const DOCUMENT_MAX_BULLETS_PER_SECTION = 200;
export const DOCUMENT_MAX_TABLE_ROWS = 500;
export const DOCUMENT_MAX_TABLE_COLUMNS = 20;
export const DOCUMENT_MAX_TEXT_CHARS = 8000;

export const SPREADSHEET_MAX_SHEETS = 8;
export const SPREADSHEET_MAX_COLUMNS = 60;
export const SPREADSHEET_MAX_ROWS_PER_SHEET = 5000;
export const SPREADSHEET_MAX_CELLS = 100_000;
export const SPREADSHEET_MAX_CELL_CHARS = 2000;

export const PRESENTATION_MAX_SLIDES = 60;
export const PRESENTATION_MAX_CHART_CATEGORIES = 24;
export const PRESENTATION_MAX_CHART_SERIES = 6;

/** 交付物插图：只允许引用本地已保存图片，单份文件最多 8 张。 */
export const ARTIFACT_IMAGE_MAX_COUNT = 8;
export const ARTIFACT_IMAGE_MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const ARTIFACT_IMAGE_MAX_WIDTH = 1600;
export const ARTIFACT_IMAGE_MAX_HEIGHT = 1600;
export const PRESENTATION_MAX_BULLETS_PER_SLIDE = 6;
export const PRESENTATION_MAX_TABLE_ROWS = 20;
export const PRESENTATION_MAX_TABLE_COLUMNS = 8;
export const PRESENTATION_MAX_TEXT_CHARS = 240;
