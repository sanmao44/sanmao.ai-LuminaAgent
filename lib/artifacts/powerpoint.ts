import PptxGenJS from 'pptxgenjs';
import {
  PRESENTATION_MAX_BULLETS_PER_SLIDE,
  PRESENTATION_MAX_CHART_CATEGORIES,
  PRESENTATION_MAX_CHART_SERIES,
  PRESENTATION_MAX_SLIDES,
  PRESENTATION_MAX_TABLE_COLUMNS,
  PRESENTATION_MAX_TABLE_ROWS,
  PRESENTATION_MAX_TEXT_CHARS,
} from './limits';
import { forceArtifactExtension } from './sanitize';
import { emWidthFor, textWidthEm, wrapText } from './typography';
import { assertArchiveParts } from './validate';
import { loadArtifactImages, type ArtifactGenerateOptions, type ArtifactImage, type ArtifactImageInput } from './images';
import type { ArtifactBuild } from './types';

export type PresentationTableInput = {
  columns?: string[];
  rows: Array<Array<string | number | null>>;
};

/** 图表只吃结构化数据，不依赖外部图片，避免把网络下载带进交付链路。 */
export type PresentationChartInput = {
  type?: 'bar' | 'line' | 'pie' | 'doughnut' | 'area';
  categories?: Array<string | number | null>;
  series?: Array<{ name?: string; values?: Array<number | null> }>;
};

export type PresentationSlideLayout = 'title' | 'section' | 'bullets' | 'two-column' | 'table' | 'chart' | 'image';

export type PresentationSlideInput = {
  layout?: PresentationSlideLayout;
  title?: string;
  subtitle?: string;
  bullets?: string[];
  leftTitle?: string;
  leftBullets?: string[];
  rightTitle?: string;
  rightBullets?: string[];
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  chart?: PresentationChartInput;
  image?: ArtifactImageInput;
  notes?: string;
};

export type PresentationInput = {
  filename?: string;
  title?: string;
  subtitle?: string;
  theme?: string;
  markdown?: string;
  slides?: PresentationSlideInput[];
};

type DeckTheme = {
  background: string;
  surface: string;
  surfaceAlt: string;
  title: string;
  body: string;
  accent: string;
  onAccent: string;
  border: string;
  font: string;
  chartPalette: readonly string[];
};

const THEMES: Record<string, DeckTheme> = {
  'sanmao-dark': {
    background: '0B1220', surface: '131E31', surfaceAlt: '0F1A2A',
    title: 'F8FAFC', body: 'C7D2E0', accent: '3B82F6', onAccent: 'FFFFFF',
    border: '22304A', font: '微软雅黑',
    chartPalette: ['3B82F6', '22D3EE', 'A855F7', 'F59E0B', '10B981', 'F43F5E'],
  },
  'sanmao-light': {
    background: 'FFFFFF', surface: 'F4F7FB', surfaceAlt: 'EAF0F8',
    title: '0F172A', body: '3A475C', accent: '2563EB', onAccent: 'FFFFFF',
    border: 'D7E0EC', font: '微软雅黑',
    chartPalette: ['2563EB', '0891B2', '7C3AED', 'D97706', '059669', 'DC2626'],
  },
};

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const MARGIN = 0.6;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;
const HEADER_Y = 0.46;
const BODY_BOTTOM = 6.45;
const FOOTER_Y = 6.9;
const CARD_GAP = 0.12;
const CARD_MIN_HEIGHT = 0.52;
const CARD_TEXT_INSET = 0.34;
const CARD_PADDING_X = 0.24;
const LINE_HEIGHT_FACTOR = 1.34;
const BULLET_FONT_LADDER = [16, 15, 14, 13, 12, 11];
const COLUMN_FONT_LADDER = [15, 14, 13, 12, 11];
const TABLE_FONT_LADDER = [14, 13, 12, 11, 10];
const TITLE_FONT_LADDER = [30, 28, 26, 24, 22, 20];
/** 插图按 96dpi 折算成英寸，再等比放进正文区；图注预留固定高度。 */
const IMAGE_DPI = 96;
const IMAGE_CAPTION_HEIGHT = 0.46;
const IMAGE_MAX_UPSCALE = 2;

const IMAGE_MIME: Record<ArtifactImage['type'], string> = {
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', bmp: 'image/bmp',
};

function themeFor(name: unknown) {
  const key = String(name || 'sanmao-dark').trim().toLowerCase();
  return THEMES[key] || THEMES['sanmao-dark'];
}

function clip(text: unknown, warnings: string[], context: string, max = PRESENTATION_MAX_TEXT_CHARS) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  warnings.push(`${context}文字过长，已截断`);
  return `${value.slice(0, max - 1)}…`;
}

function lineHeightIn(fontSize: number) {
  return (fontSize * LINE_HEIGHT_FACTOR) / 72;
}

/** 标题块高度随字号与行数变化，正文起点跟着下移，避免标题压到内容。 */
function headerMetrics(title: string, theme: DeckTheme) {
  const text = title.trim() || ' ';
  let fontSize = TITLE_FONT_LADDER[TITLE_FONT_LADDER.length - 1];
  let lines = wrapText(text, emWidthFor(CONTENT_WIDTH - 1.2, fontSize));
  for (const size of TITLE_FONT_LADDER) {
    const wrapped = wrapText(text, emWidthFor(CONTENT_WIDTH - 1.2, size));
    if (wrapped.length <= 1) {
      fontSize = size;
      lines = wrapped;
      break;
    }
  }
  if (lines.length > 2) lines = lines.slice(0, 2);
  const titleHeight = Math.max(0.68, lines.length * lineHeightIn(fontSize) + 0.12);
  const ruleY = HEADER_Y + titleHeight + 0.04;
  return { text: lines.join('\n'), fontSize, titleHeight, ruleY, bodyTop: ruleY + 0.3 };
}

function drawHeader(slide: PptxGenJS.Slide, theme: DeckTheme, title: string) {
  const metrics = headerMetrics(title, theme);
  slide.addText(metrics.text, {
    x: MARGIN, y: HEADER_Y, w: CONTENT_WIDTH, h: metrics.titleHeight,
    fontSize: metrics.fontSize, bold: true, color: theme.title, fontFace: theme.font,
    valign: 'middle', margin: 0, lineSpacing: metrics.fontSize * LINE_HEIGHT_FACTOR,
  });
  slide.addShape('rect', { x: MARGIN, y: metrics.ruleY, w: 1.1, h: 0.055, fill: { color: theme.accent } });
  return metrics.bodyTop;
}

function addFooter(slide: PptxGenJS.Slide, theme: DeckTheme, pageNumber: number, total: number) {
  slide.addShape('rect', { x: MARGIN, y: FOOTER_Y - 0.14, w: CONTENT_WIDTH, h: 0.012, fill: { color: theme.border } });
  slide.addText('SANMAO.AI', { x: MARGIN, y: FOOTER_Y, w: 3, h: 0.3, fontSize: 10, color: theme.body, fontFace: theme.font });
  slide.addText(`${pageNumber} / ${total}`, { x: SLIDE_WIDTH - MARGIN - 2, y: FOOTER_Y, w: 2, h: 0.3, fontSize: 10, color: theme.body, align: 'right', fontFace: theme.font });
}

function cardTextWidth() {
  return CONTENT_WIDTH - CARD_TEXT_INSET - CARD_PADDING_X;
}

/** 单张卡片的高度：先按字号把文字排成固定行，再算出卡片高度，文字一定不会溢出来。 */
function cardHeight(item: string, fontSize: number) {
  const lines = wrapText(item, emWidthFor(cardTextWidth(), fontSize));
  return Math.max(CARD_MIN_HEIGHT, lines.length * lineHeightIn(fontSize) + 0.24);
}

function bulletBlockHeight(items: string[], fontSize: number) {
  if (!items.length) return 0;
  return items.reduce((sum, item) => sum + cardHeight(item, fontSize), 0) + CARD_GAP * (items.length - 1);
}

function bulletFontFor(items: string[], availableHeight: number) {
  for (const size of BULLET_FONT_LADDER) {
    if (bulletBlockHeight(items, size) <= availableHeight) return size;
  }
  return null;
}

/** 先按每页上限切块，再按可用高度分页；任何一页都不会超出正文区域。 */
function packBulletPages(title: string | undefined, items: string[], theme: DeckTheme) {
  const pages: Array<{ title: string; items: string[]; bodyTop: number }> = [];
  let cursor = 0;
  let pageIndex = 0;
  while (cursor < items.length) {
    const pageTitle = pageIndex === 0 ? String(title || '') : `${title || '内容'}（续）`;
    const bodyTop = headerMetrics(pageTitle, theme).bodyTop;
    const available = BODY_BOTTOM - bodyTop;
    let taken = 0;
    while (taken < PRESENTATION_MAX_BULLETS_PER_SLIDE && cursor + taken < items.length) {
      const candidate = items.slice(cursor, cursor + taken + 1);
      if (!bulletFontFor(candidate, available)) break;
      taken += 1;
    }
    if (!taken) taken = 1;
    pages.push({ title: pageTitle, items: items.slice(cursor, cursor + taken), bodyTop });
    cursor += taken;
    pageIndex += 1;
  }
  return pages;
}

function drawCards(slide: PptxGenJS.Slide, theme: DeckTheme, items: string[], bodyTop: number, fontSize: number, availableHeight: number) {
  const blockHeight = bulletBlockHeight(items, fontSize);
  const shift = Math.min(0.45, Math.max(0, (availableHeight - blockHeight) / 2));
  let y = bodyTop + shift;
  const textWidth = cardTextWidth();
  const lineSpacing = fontSize * LINE_HEIGHT_FACTOR;
  for (const item of items) {
    const lines = wrapText(item, emWidthFor(textWidth, fontSize));
    const height = Math.max(CARD_MIN_HEIGHT, lines.length * lineHeightIn(fontSize) + 0.24);
    slide.addShape('roundRect', {
      x: MARGIN, y, w: CONTENT_WIDTH, h: height, rectRadius: 0.06,
      fill: { color: theme.surface }, line: { color: theme.border, width: 0.75 },
    });
    slide.addShape('rect', { x: MARGIN, y: y + 0.11, w: 0.05, h: Math.max(0.2, height - 0.22), fill: { color: theme.accent } });
    slide.addText(lines.join('\n'), {
      x: MARGIN + CARD_TEXT_INSET, y: y + 0.12, w: textWidth, h: height - 0.24,
      fontSize, color: theme.body, fontFace: theme.font, valign: 'middle', margin: 0,
      lineSpacing,
    });
    y += height + CARD_GAP;
  }
}

function columnInnerWidth() {
  return (CONTENT_WIDTH - 0.4) / 2 - 0.52;
}

/** 一栏内容需要多高：面板高度按内容走，不留一大片空白。 */
function columnContentHeight(column: { title: string; bullets: string[] }, fontSize: number) {
  const innerWidth = columnInnerWidth() - 0.22;
  let height = column.title ? 0.5 : 0.12;
  for (const bullet of column.bullets) {
    height += wrapText(bullet, emWidthFor(innerWidth, fontSize)).length * lineHeightIn(fontSize) + 0.16;
  }
  return height + 0.2;
}

function drawColumns(
  slide: PptxGenJS.Slide, theme: DeckTheme,
  column: { title: string; bullets: string[]; x: number; width: number },
  panelTop: number, panelHeight: number, fontSize: number,
) {
  slide.addShape('roundRect', {
    x: column.x, y: panelTop, w: column.width, h: panelHeight, rectRadius: 0.06,
    fill: { color: theme.surface }, line: { color: theme.border, width: 0.75 },
  });
  const innerX = column.x + 0.26;
  const innerWidth = column.width - 0.52;
  let y = panelTop + 0.2;
  if (column.title) {
    slide.addText(wrapText(column.title, emWidthFor(innerWidth, 15)).slice(0, 2).join('\n'), {
      x: innerX, y, w: innerWidth, h: 0.42, fontSize: 15, bold: true, color: theme.accent,
      fontFace: theme.font, valign: 'middle', margin: 0,
    });
    y += 0.5;
  }
  const lineSpacing = fontSize * LINE_HEIGHT_FACTOR;
  let first = true;
  for (const bullet of column.bullets) {
    const lines = wrapText(bullet, emWidthFor(innerWidth - 0.22, fontSize));
    const height = lines.length * lineHeightIn(fontSize) + 0.1;
    slide.addShape('rect', { x: innerX, y: y + 0.09, w: 0.07, h: 0.07, fill: { color: theme.accent } });
    slide.addText(lines.join('\n'), {
      x: innerX + 0.2, y, w: innerWidth - 0.2, h: height,
      fontSize, color: theme.body, fontFace: theme.font, valign: 'top', margin: 0, lineSpacing,
    });
    y += height + (first ? 0.06 : 0.1);
    first = false;
  }
}

function columnFontFor(columns: Array<{ title: string; bullets: string[] }>, height: number) {
  for (const size of COLUMN_FONT_LADDER) {
    const needed = columns.reduce((max, column) => Math.max(max, columnContentHeight(column, size)), 0);
    if (needed <= height) return size;
  }
  return COLUMN_FONT_LADDER[COLUMN_FONT_LADDER.length - 1];
}

function columnWidths(matrix: string[][], columnCount: number) {
  const minWidth = 0.85;
  const usable = CONTENT_WIDTH;
  const weights = Array.from({ length: columnCount }, (_, index) => {
    const longest = matrix.reduce((max, row) => Math.max(max, textWidthEm(row[index] || '')), 0);
    return Math.max(3, Math.min(30, longest));
  });
  const total = weights.reduce((sum, value) => sum + value, 0) || columnCount;
  const widths = weights.map((weight) => Math.max(minWidth, (usable * weight) / total));
  const sum = widths.reduce((total2, value) => total2 + value, 0);
  return widths.map((value) => (value * usable) / sum);
}

function drawTable(slide: PptxGenJS.Slide, theme: DeckTheme, input: PresentationTableInput, warnings: string[], context: string, bodyTop: number) {
  const rawRows = input.rows || [];
  const rows = rawRows.slice(0, PRESENTATION_MAX_TABLE_ROWS);
  if (rawRows.length > PRESENTATION_MAX_TABLE_ROWS) warnings.push(`${context}表格超过 ${PRESENTATION_MAX_TABLE_ROWS} 行，已截断`);
  const headerTexts = (input.columns || []).map((column) => clip(column, warnings, `${context}表头`, 40));
  const columnCount = Math.max(1, Math.min(PRESENTATION_MAX_TABLE_COLUMNS, Math.max(headerTexts.length, ...rows.map((row) => row.length), 1)));
  if ((input.columns?.length || 0) > PRESENTATION_MAX_TABLE_COLUMNS) warnings.push(`${context}表格超过 ${PRESENTATION_MAX_TABLE_COLUMNS} 列，已截断`);
  const bodyTexts = rows.map((row) => Array.from({ length: columnCount }, (_, index) => clip(row[index], warnings, `${context}表格`, 60)));
  const matrix = [headerTexts.length ? headerTexts.slice(0, columnCount) : [], ...bodyTexts];
  const available = BODY_BOTTOM - bodyTop;

  let fontSize = TABLE_FONT_LADDER[TABLE_FONT_LADDER.length - 1];
  let widths: number[] = [];
  let keptRows = bodyTexts;
  let rowHeights: number[] = [];
  for (const size of TABLE_FONT_LADDER) {
    widths = columnWidths(matrix, columnCount);
    const measure = (cells: string[]) => Math.max(0.36, Math.max(...cells.map((cell, index) => wrapText(cell, emWidthFor(widths[index] - 0.22, size)).length)) * lineHeightIn(size) + 0.16);
    rowHeights = [headerTexts.length ? measure(headerTexts.slice(0, columnCount)) : 0, ...bodyTexts.map(measure)];
    const total = rowHeights.reduce((sum, value) => sum + value, 0);
    fontSize = size;
    if (total <= available) break;
  }
  const headerHeight = headerTexts.length ? rowHeights[0] : 0;
  let total = rowHeights.reduce((sum, value) => sum + value, 0);
  while (total > available && keptRows.length > 1) {
    keptRows = keptRows.slice(0, keptRows.length - 1);
    rowHeights = [headerHeight, ...rowHeights.slice(1, keptRows.length + 1)];
    total = rowHeights.reduce((sum, value) => sum + value, 0);
    warnings.push(`${context}表格高度超出页面，已减少行数`);
  }

  const tableRows: PptxGenJS.TableRow[] = [];
  if (headerTexts.length) {
    tableRows.push(headerTexts.slice(0, columnCount).map((text, index) => ({
      text: wrapText(text, emWidthFor(widths[index] - 0.22, fontSize)).join('\n'),
      options: { bold: true, color: theme.onAccent, fontSize, fill: { color: theme.accent }, align: 'center' as const, valign: 'middle' as const, margin: 0.06 },
    })));
  }
  keptRows.forEach((cells, rowIndex) => {
    const fill = rowIndex % 2 === 0 ? theme.surface : theme.surfaceAlt;
    tableRows.push(cells.map((cell, index) => ({
      text: wrapText(cell, emWidthFor(widths[index] - 0.22, fontSize)).join('\n'),
      options: { color: theme.body, fontSize, fill: { color: fill }, valign: 'middle' as const, margin: 0.06 },
    })));
  });

  slide.addTable(tableRows, {
    x: MARGIN, y: bodyTop, w: CONTENT_WIDTH,
    colW: widths,
    rowH: rowHeights.slice(0, tableRows.length),
    border: { type: 'solid', color: theme.border, pt: 0.75 },
    fontFace: theme.font,
    autoPage: false,
    valign: 'middle',
  });
}

type NormalizedChart = {
  type: PptxGenJS.CHART_NAME;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
};

const CHART_TYPES: Record<string, PptxGenJS.CHART_NAME> = {
  bar: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut', area: 'area',
};

/**
 * 图表数据先归一化：截断超限、补齐长度、剔除非法数值。
 * 直接把模型给的原始数组交给 pptxgenjs 会写出坏 XML，打开时 PowerPoint 会报修复。
 */
export function normalizeChartInput(raw: unknown, warnings: string[], context: string): NormalizedChart | null {
  const chart = (raw && typeof raw === 'object' ? raw : null) as PresentationChartInput | null;
  if (!chart) return null;
  const requested = String(chart.type || 'bar').trim().toLowerCase();
  const type = CHART_TYPES[requested];
  if (!type) warnings.push(`${context}不支持的图表类型「${chart.type}」，已改用柱状图`);

  const rawSeries = Array.isArray(chart.series) ? chart.series : [];
  if (rawSeries.length > PRESENTATION_MAX_CHART_SERIES) warnings.push(`${context}图表系列超过 ${PRESENTATION_MAX_CHART_SERIES} 组，已截断`);
  let series = rawSeries.slice(0, PRESENTATION_MAX_CHART_SERIES).map((entry, index) => ({
    name: clip(entry?.name, warnings, context, 40) || `系列 ${index + 1}`,
    values: (Array.isArray(entry?.values) ? entry.values : []).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)),
  })).filter((entry) => entry.values.length);

  const rawCategories = Array.isArray(chart.categories) ? chart.categories : [];
  const width = Math.max(rawCategories.length, ...series.map((entry) => entry.values.length), 0);
  if (!series.length || !width) return null;
  if (width > PRESENTATION_MAX_CHART_CATEGORIES) warnings.push(`${context}图表分类超过 ${PRESENTATION_MAX_CHART_CATEGORIES} 个，已截断`);
  if ((type === 'pie' || type === 'doughnut') && series.length > 1) {
    warnings.push(`${context}饼图只能表达一组数据，已使用第一组系列`);
    series = series.slice(0, 1);
  }

  const size = Math.min(width, PRESENTATION_MAX_CHART_CATEGORIES);
  const categories = Array.from({ length: size }, (_, index) => {
    const label = rawCategories[index];
    const text = label === undefined || label === null ? '' : clip(label, warnings, context, 24);
    return text.trim() || `第 ${index + 1} 项`;
  });
  return {
    type: type || 'bar',
    categories,
    series: series.map((entry) => ({
      name: entry.name,
      values: Array.from({ length: size }, (_, index) => entry.values[index] ?? 0),
    })),
  };
}

function drawChart(slide: PptxGenJS.Slide, theme: DeckTheme, chart: NormalizedChart, bodyTop: number) {
  const isPie = chart.type === 'pie' || chart.type === 'doughnut';
  slide.addChart(
    chart.type,
    chart.series.map((entry) => ({ name: entry.name, labels: chart.categories, values: entry.values })),
    {
      x: MARGIN,
      y: bodyTop,
      w: CONTENT_WIDTH,
      h: Math.max(1.6, BODY_BOTTOM - bodyTop),
      chartColors: [...theme.chartPalette],
      fill: theme.surface,
      border: { pt: 1, color: theme.border },
      fontFace: theme.font,
      color: theme.body,
      showTitle: false,
      showLegend: isPie || chart.series.length > 1,
      legendPos: 'b',
      legendColor: theme.body,
      legendFontFace: theme.font,
      legendFontSize: 11,
      showValue: isPie,
      dataLabelColor: theme.title,
      dataLabelFontFace: theme.font,
      dataLabelFontSize: 11,
      catAxisLabelColor: theme.body,
      catAxisLabelFontFace: theme.font,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: theme.body,
      valAxisLabelFontFace: theme.font,
      valAxisLabelFontSize: 11,
      valGridLine: { color: theme.border, size: 0.5 },
      catGridLine: { style: 'none' },
      barGapWidthPct: 40,
    },
  );
}

/**
 * 插图页：等比缩放到正文区居中，最多放大 2 倍，避免小图被拉成马赛克。
 */
function drawImageSlide(slide: PptxGenJS.Slide, theme: DeckTheme, image: ArtifactImage, caption: string, bodyTop: number) {
  const available = Math.max(1.2, BODY_BOTTOM - bodyTop - (caption ? IMAGE_CAPTION_HEIGHT : 0));
  const naturalWidth = image.width / IMAGE_DPI;
  const naturalHeight = image.height / IMAGE_DPI;
  const scale = Math.min(CONTENT_WIDTH / naturalWidth, available / naturalHeight, IMAGE_MAX_UPSCALE);
  const width = Math.max(0.6, naturalWidth * scale);
  const height = Math.max(0.6, naturalHeight * scale);
  slide.addImage({
    data: `${IMAGE_MIME[image.type]};base64,${image.data.toString('base64')}`,
    x: MARGIN + Math.max(0, (CONTENT_WIDTH - width) / 2),
    y: bodyTop + Math.max(0, (available - height) / 2),
    w: width,
    h: height,
    ...(image.caption ? { altText: image.caption } : {}),
  });
  if (caption) {
    slide.addText(caption, {
      x: MARGIN, y: BODY_BOTTOM - IMAGE_CAPTION_HEIGHT, w: CONTENT_WIDTH, h: IMAGE_CAPTION_HEIGHT,
      fontSize: 12, color: theme.body, fontFace: theme.font, align: 'center', valign: 'middle',
    });
  }
}

/** Markdown 简写：`#` 作为标题页，`##` 作为内容页，列表项作为要点。 */
export function markdownToSlides(markdown: string): PresentationSlideInput[] {
  const slides: PresentationSlideInput[] = [];
  let current: PresentationSlideInput | null = null;
  for (const rawLine of String(markdown || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      if (level === 1) {
        current = { layout: 'title', title: heading[2].trim() };
      } else if (level === 2 || level === 3) {
        current = { layout: 'bullets', title: heading[2].trim(), bullets: [] };
      } else if (current) {
        current.bullets = [...(current.bullets || []), heading[2].trim()];
        continue;
      } else {
        current = { layout: 'bullets', title: heading[2].trim(), bullets: [] };
      }
      slides.push(current);
      continue;
    }
    if (/^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      const text = line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '');
      if (!current) {
        current = { layout: 'bullets', title: '', bullets: [] };
        slides.push(current);
      }
      if (current.layout === 'title') current.subtitle = [current.subtitle, text].filter(Boolean).join(' ');
      else current.bullets = [...(current.bullets || []), text];
      continue;
    }
    if (!current) {
      current = { layout: 'title', title: line };
      slides.push(current);
      continue;
    }
    if (current.layout === 'title') current.subtitle = [current.subtitle, line].filter(Boolean).join(' ');
    else current.bullets = [...(current.bullets || []), line];
  }
  return slides;
}

/** 一页要点过多时拆页而不是硬塞，避免文字跑出页面。 */
function expandSlides(input: PresentationSlideInput[]) {
  const expanded: PresentationSlideInput[] = [];
  for (const slide of input) {
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    if ((slide.layout || 'bullets') === 'bullets' && bullets.length > PRESENTATION_MAX_BULLETS_PER_SLIDE) {
      for (let index = 0; index < bullets.length; index += PRESENTATION_MAX_BULLETS_PER_SLIDE) {
        expanded.push({
          ...slide,
          title: index === 0 ? slide.title : `${slide.title || '内容'}（续）`,
          bullets: bullets.slice(index, index + PRESENTATION_MAX_BULLETS_PER_SLIDE),
        });
      }
      continue;
    }
    expanded.push(slide);
  }
  return expanded;
}

function drawTitleSlide(slide: PptxGenJS.Slide, theme: DeckTheme, title: string, subtitle: string) {
  slide.addShape('rect', { x: MARGIN, y: 0.62, w: 0.09, h: 0.34, fill: { color: theme.accent } });
  slide.addText('SANMAO.AI', { x: MARGIN + 0.22, y: 0.62, w: 4, h: 0.34, fontSize: 13, bold: true, color: theme.accent, fontFace: theme.font, charSpacing: 1.5 });

  let fontSize = 40;
  let lines = wrapText(title, emWidthFor(CONTENT_WIDTH - 1.6, fontSize));
  for (const size of [40, 36, 32, 28, 26]) {
    const wrapped = wrapText(title, emWidthFor(CONTENT_WIDTH - 1.6, size));
    if (wrapped.length <= 2) {
      fontSize = size;
      lines = wrapped;
      break;
    }
  }
  if (lines.length > 2) lines = lines.slice(0, 2);
  const titleHeight = lines.length * lineHeightIn(fontSize) + 0.2;
  const titleY = 3.0 - titleHeight / 2;
  slide.addShape('rect', { x: (SLIDE_WIDTH - 1.6) / 2, y: titleY - 0.42, w: 1.6, h: 0.06, fill: { color: theme.accent } });
  slide.addText(lines.join('\n'), {
    x: MARGIN, y: titleY, w: CONTENT_WIDTH, h: titleHeight,
    fontSize, bold: true, color: theme.title, align: 'center', fontFace: theme.font,
    valign: 'middle', margin: 0, lineSpacing: fontSize * LINE_HEIGHT_FACTOR,
  });
  if (subtitle) {
    const subtitleLines = wrapText(subtitle, emWidthFor(CONTENT_WIDTH - 2.4, 18)).slice(0, 3);
    const height = subtitleLines.length * lineHeightIn(18) + 0.16;
    slide.addText(subtitleLines.join('\n'), {
      x: MARGIN + 0.6, y: titleY + titleHeight + 0.22, w: CONTENT_WIDTH - 1.2, h: height,
      fontSize: 18, color: theme.body, align: 'center', fontFace: theme.font,
      valign: 'middle', margin: 0, lineSpacing: 18 * LINE_HEIGHT_FACTOR,
    });
  }
}

function drawSectionSlide(slide: PptxGenJS.Slide, theme: DeckTheme, title: string, subtitle: string) {
  const fontSize = title.length > 26 ? 26 : 32;
  const lines = wrapText(title || ' ', emWidthFor(CONTENT_WIDTH - 1.6, fontSize)).slice(0, 2);
  const height = lines.length * lineHeightIn(fontSize) + 0.2;
  const y = SLIDE_HEIGHT / 2 - height / 2 - 0.2;
  slide.addShape('rect', { x: (SLIDE_WIDTH - 1.2) / 2, y: y - 0.44, w: 1.2, h: 0.06, fill: { color: theme.accent } });
  slide.addText(lines.join('\n'), {
    x: MARGIN, y, w: CONTENT_WIDTH, h: height,
    fontSize, bold: true, color: theme.title, align: 'center', fontFace: theme.font,
    valign: 'middle', margin: 0, lineSpacing: fontSize * LINE_HEIGHT_FACTOR,
  });
  if (subtitle) {
    const subtitleLines = wrapText(subtitle, emWidthFor(CONTENT_WIDTH - 2.4, 16)).slice(0, 3);
    slide.addText(subtitleLines.join('\n'), {
      x: MARGIN + 0.6, y: y + height + 0.24, w: CONTENT_WIDTH - 1.2, h: subtitleLines.length * lineHeightIn(16) + 0.16,
      fontSize: 16, color: theme.body, align: 'center', fontFace: theme.font,
      valign: 'middle', margin: 0, lineSpacing: 16 * LINE_HEIGHT_FACTOR,
    });
  }
}

export async function buildPresentation(input: PresentationInput, options: ArtifactGenerateOptions = {}): Promise<ArtifactBuild> {
  const warnings: string[] = [];
  const theme = themeFor(input.theme);
  const slides = [...(Array.isArray(input.slides) ? input.slides : [])];
  if (typeof input.markdown === 'string' && input.markdown.trim()) slides.push(...markdownToSlides(input.markdown));
  if (!slides.length && (input.title?.trim() || input.subtitle?.trim())) {
    slides.push({ layout: 'title', title: input.title, subtitle: input.subtitle });
  }
  if (!slides.length) throw new Error('PPT 内容为空：请在 slides 或 markdown 里提供页面内容');

  const planned: PresentationSlideInput[] = [];
  for (const slide of expandSlides(slides)) {
    const layout = slide.layout || 'bullets';
    const context = `第 ${planned.length + 1} 页`;
    if (layout === 'bullets') {
      const items = (slide.bullets || []).map((item) => clip(item, warnings, context, 200)).filter(Boolean);
      for (const page of packBulletPages(slide.title, items, theme)) {
        planned.push({ ...slide, layout: 'bullets', title: page.title, bullets: page.items });
      }
      continue;
    }
    if (layout === 'two-column') {
      const all = [...(slide.leftBullets || []), ...(slide.rightBullets || [])];
      if (all.length <= PRESENTATION_MAX_BULLETS_PER_SLIDE * 2) {
        planned.push({
          ...slide,
          leftBullets: (slide.leftBullets || []).map((item) => clip(item, warnings, context, 160)),
          rightBullets: (slide.rightBullets || []).map((item) => clip(item, warnings, context, 160)),
        });
        continue;
      }
      warnings.push(`${context}双栏要点过多，已截断`);
      planned.push({
        ...slide,
        leftBullets: (slide.leftBullets || []).slice(0, PRESENTATION_MAX_BULLETS_PER_SLIDE).map((item) => clip(item, warnings, context, 160)),
        rightBullets: (slide.rightBullets || []).slice(0, PRESENTATION_MAX_BULLETS_PER_SLIDE).map((item) => clip(item, warnings, context, 160)),
      });
      continue;
    }
    planned.push(slide);
  }

  if (planned.length > PRESENTATION_MAX_SLIDES) warnings.push(`幻灯片超过 ${PRESENTATION_MAX_SLIDES} 页，已截断`);
  const finalSlides = planned.slice(0, PRESENTATION_MAX_SLIDES);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'SANMAO.AI';
  pptx.company = 'SANMAO.AI';
  if (input.title?.trim()) pptx.title = input.title.trim();

  for (const [index, slideInput] of finalSlides.entries()) {
    const layout = slideInput.layout || 'bullets';
    const slide = pptx.addSlide();
    slide.background = { color: theme.background };
    const context = `第 ${index + 1} 页`;
    if (layout === 'title') {
      drawTitleSlide(
        slide, theme,
        clip(slideInput.title || input.title, warnings, context, 80) || ' ',
        clip(slideInput.subtitle || input.subtitle, warnings, context, 160),
      );
    } else if (layout === 'section') {
      drawSectionSlide(
        slide, theme,
        clip(slideInput.title, warnings, context, 80) || ' ',
        clip(slideInput.subtitle, warnings, context, 120),
      );
    } else if (layout === 'table') {
      const bodyTop = drawHeader(slide, theme, clip(slideInput.title, warnings, context, 80));
      drawTable(slide, theme, { columns: slideInput.columns, rows: slideInput.rows || [] }, warnings, context, bodyTop);
    } else if (layout === 'chart') {
      const bodyTop = drawHeader(slide, theme, clip(slideInput.title, warnings, context, 80));
      const chart = normalizeChartInput(slideInput.chart, warnings, context);
      if (chart) {
        drawChart(slide, theme, chart, bodyTop);
      } else {
        warnings.push(`${context}图表缺少有效数据，已跳过绘图`);
        slide.addText('（图表数据为空）', {
          x: MARGIN, y: bodyTop + 0.4, w: CONTENT_WIDTH, h: 0.6,
          fontSize: 14, color: theme.body, fontFace: theme.font, align: 'center',
        });
      }
    } else if (layout === 'image') {
      const bodyTop = drawHeader(slide, theme, clip(slideInput.title, warnings, context, 80));
      const images = await loadArtifactImages(slideInput.image ? [slideInput.image] : [], {
        warnings,
        context,
        roots: options.imageRoots,
      });
      const image = images[0];
      if (image) {
        drawImageSlide(slide, theme, image, clip(slideInput.subtitle, warnings, context, 80), bodyTop);
      } else {
        warnings.push(`${context}没有可用的插图，已跳过绘图`);
        slide.addText('（图片不可用）', {
          x: MARGIN, y: bodyTop + 0.4, w: CONTENT_WIDTH, h: 0.6,
          fontSize: 14, color: theme.body, fontFace: theme.font, align: 'center',
        });
      }
    } else if (layout === 'two-column') {
      const bodyTop = drawHeader(slide, theme, clip(slideInput.title, warnings, context, 80));
      const available = BODY_BOTTOM - bodyTop;
      const columnWidth = (CONTENT_WIDTH - 0.4) / 2;
      const columns = [
        { title: clip(slideInput.leftTitle, warnings, context, 40) || '', bullets: (slideInput.leftBullets || []).filter(Boolean), x: MARGIN, width: columnWidth },
        { title: clip(slideInput.rightTitle, warnings, context, 40) || '', bullets: (slideInput.rightBullets || []).filter(Boolean), x: MARGIN + columnWidth + 0.4, width: columnWidth },
      ];
      const fontSize = columnFontFor(columns, available);
      const panelHeight = Math.min(available, Math.max(...columns.map((column) => columnContentHeight(column, fontSize))) + 0.36);
      const panelTop = bodyTop + Math.min(0.45, Math.max(0, (available - panelHeight) / 2));
      for (const column of columns) drawColumns(slide, theme, column, panelTop, panelHeight, fontSize);
    } else {
      const bodyTop = drawHeader(slide, theme, clip(slideInput.title, warnings, context, 80));
      const items = (slideInput.bullets || []).filter(Boolean);
      const available = BODY_BOTTOM - bodyTop;
      const fontSize = bulletFontFor(items, available) || BULLET_FONT_LADDER[BULLET_FONT_LADDER.length - 1];
      if (items.length) drawCards(slide, theme, items, bodyTop, fontSize, available);
    }
    if (slideInput.notes?.trim()) slide.addNotes(String(slideInput.notes).slice(0, 4000));
    if (layout !== 'title') addFooter(slide, theme, index + 1, finalSlides.length);
  }

  const output = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  assertArchiveParts(buffer, ['ppt/presentation.xml', 'ppt/slides/slide1.xml'], 'PPT 演示文稿');
  return { buffer, warnings };
}

export function resolvePresentationFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-演示文稿.pptx';
  return forceArtifactExtension(base, '.pptx');
}
