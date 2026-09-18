import PptxGenJS from 'pptxgenjs';
import {
  PRESENTATION_MAX_BULLETS_PER_SLIDE,
  PRESENTATION_MAX_SLIDES,
  PRESENTATION_MAX_TABLE_COLUMNS,
  PRESENTATION_MAX_TABLE_ROWS,
  PRESENTATION_MAX_TEXT_CHARS,
} from './limits';
import { forceArtifactExtension } from './sanitize';
import { assertArchiveParts } from './validate';
import type { ArtifactBuild } from './types';

export type PresentationTableInput = {
  columns?: string[];
  rows: Array<Array<string | number | null>>;
};

export type PresentationSlideLayout = 'title' | 'section' | 'bullets' | 'two-column' | 'table';

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
  title: string;
  body: string;
  accent: string;
  border: string;
  font: string;
};

const THEMES: Record<string, DeckTheme> = {
  'sanmao-dark': { background: '0B1220', surface: '111C2E', title: 'F8FAFC', body: 'CBD5E1', accent: '3B82F6', border: '1E293B', font: '微软雅黑' },
  'sanmao-light': { background: 'FFFFFF', surface: 'F1F5F9', title: '0F172A', body: '334155', accent: '2563EB', border: 'CBD5E1', font: '微软雅黑' },
};

const SLIDE_WIDTH = 13.333;
const SLIDE_HEIGHT = 7.5;
const MARGIN = 0.6;
const CONTENT_WIDTH = SLIDE_WIDTH - MARGIN * 2;

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

function addFooter(slide: PptxGenJS.Slide, theme: DeckTheme, pageNumber: number, total: number) {
  slide.addText('SANMAO.AI', { x: MARGIN, y: SLIDE_HEIGHT - 0.55, w: 3, h: 0.3, fontSize: 10, color: theme.body, fontFace: theme.font });
  slide.addText(`${pageNumber} / ${total}`, { x: SLIDE_WIDTH - MARGIN - 2, y: SLIDE_HEIGHT - 0.55, w: 2, h: 0.3, fontSize: 10, color: theme.body, align: 'right', fontFace: theme.font });
}

function slideTitle(slide: PptxGenJS.Slide, theme: DeckTheme, text: string) {
  slide.addText(text || ' ', {
    x: MARGIN, y: MARGIN * 0.7, w: CONTENT_WIDTH, h: 0.9,
    fontSize: 28, bold: true, color: theme.title, fontFace: theme.font, valign: 'middle',
  });
  slide.addShape('rect', { x: MARGIN, y: MARGIN * 0.7 + 0.95, w: 1.1, h: 0.06, fill: { color: theme.accent } });
}

function bulletText(items: string[], theme: DeckTheme) {
  return items.map((item) => ({ text: item, options: { bullet: true, breakLine: true, color: theme.body, fontSize: 16 } }));
}

function addTable(slide: PptxGenJS.Slide, theme: DeckTheme, input: PresentationTableInput, warnings: string[], context: string) {
  const rows = (input.rows || []).slice(0, PRESENTATION_MAX_TABLE_ROWS);
  if ((input.rows || []).length > PRESENTATION_MAX_TABLE_ROWS) warnings.push(`${context}表格行数超限，已截断`);
  const columnCount = Math.max(1, Math.min(PRESENTATION_MAX_TABLE_COLUMNS, input.columns?.length || 0, ...rows.map((row) => row.length)));
  const body: PptxGenJS.TableRow[] = rows.map((row) => Array.from({ length: columnCount }, (_, index) => ({
    text: clip(row[index], warnings, `${context}表格`, 80),
    options: { color: theme.body, fontSize: 12, fill: { color: theme.surface } },
  })));
  const header: PptxGenJS.TableRow[] = input.columns?.length
    ? [input.columns.slice(0, columnCount).map((column) => ({
        text: clip(column, warnings, `${context}表头`, 80),
        options: { bold: true, color: theme.title, fontSize: 12, fill: { color: theme.border } },
      }))]
    : [];
  slide.addTable([...header, ...body], {
    x: MARGIN, y: MARGIN + 1.1, w: CONTENT_WIDTH,
    colW: Array.from({ length: columnCount }, () => CONTENT_WIDTH / columnCount),
    border: { type: 'solid', color: theme.border, pt: 1 },
    fontFace: theme.font,
    valign: 'middle',
    autoPage: false,
  });
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

export async function buildPresentation(input: PresentationInput): Promise<ArtifactBuild> {
  const warnings: string[] = [];
  const theme = themeFor(input.theme);
  const slides = [...(Array.isArray(input.slides) ? input.slides : [])];
  if (typeof input.markdown === 'string' && input.markdown.trim()) slides.push(...markdownToSlides(input.markdown));
  if (!slides.length && (input.title?.trim() || input.subtitle?.trim())) {
    slides.push({ layout: 'title', title: input.title, subtitle: input.subtitle });
  }
  if (!slides.length) throw new Error('PPT 内容为空：请在 slides 或 markdown 里提供页面内容');
  if (slides.length > PRESENTATION_MAX_SLIDES) warnings.push(`幻灯片超过 ${PRESENTATION_MAX_SLIDES} 页，已截断`);
  const finalSlides = expandSlides(slides).slice(0, PRESENTATION_MAX_SLIDES);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = 'SANMAO.AI';
  pptx.company = 'SANMAO.AI';
  if (input.title?.trim()) pptx.title = input.title.trim();

  finalSlides.forEach((slideInput, index) => {
    const layout = slideInput.layout || 'bullets';
    const slide = pptx.addSlide();
    slide.background = { color: theme.background };
    const context = `第 ${index + 1} 页`;
    if (layout === 'title') {
      slide.addText(clip(slideInput.title || input.title, warnings, context, 80) || ' ', {
        x: MARGIN, y: SLIDE_HEIGHT / 2 - 1.2, w: CONTENT_WIDTH, h: 1.2,
        fontSize: 40, bold: true, color: theme.title, align: 'center', fontFace: theme.font,
      });
      const subtitle = clip(slideInput.subtitle || input.subtitle, warnings, context, 120);
      if (subtitle) {
        slide.addText(subtitle, {
          x: MARGIN, y: SLIDE_HEIGHT / 2 + 0.1, w: CONTENT_WIDTH, h: 0.8,
          fontSize: 18, color: theme.body, align: 'center', fontFace: theme.font,
        });
      }
    } else if (layout === 'section') {
      slide.addText(clip(slideInput.title, warnings, context, 80) || ' ', {
        x: MARGIN, y: SLIDE_HEIGHT / 2 - 0.8, w: CONTENT_WIDTH, h: 1.2,
        fontSize: 32, bold: true, color: theme.title, align: 'center', fontFace: theme.font,
      });
    } else if (layout === 'table') {
      slideTitle(slide, theme, clip(slideInput.title, warnings, context, 80));
      addTable(slide, theme, { columns: slideInput.columns, rows: slideInput.rows || [] }, warnings, context);
    } else if (layout === 'two-column') {
      slideTitle(slide, theme, clip(slideInput.title, warnings, context, 80));
      const columnWidth = (CONTENT_WIDTH - 0.4) / 2;
      const columns = [
        { title: slideInput.leftTitle, bullets: slideInput.leftBullets || [], x: MARGIN },
        { title: slideInput.rightTitle, bullets: slideInput.rightBullets || [], x: MARGIN + columnWidth + 0.4 },
      ];
      for (const column of columns) {
        slide.addText(clip(column.title, warnings, context, 60) || ' ', {
          x: column.x, y: MARGIN + 1.15, w: columnWidth, h: 0.5,
          fontSize: 18, bold: true, color: theme.accent, fontFace: theme.font,
        });
        const items = column.bullets.slice(0, PRESENTATION_MAX_BULLETS_PER_SLIDE + 2).map((item) => clip(item, warnings, context, 140));
        if (items.length) {
          slide.addText(bulletText(items, theme), {
            x: column.x, y: MARGIN + 1.7, w: columnWidth, h: SLIDE_HEIGHT - MARGIN * 2 - 2.2,
            fontFace: theme.font, valign: 'top', lineSpacingMultiple: 1.2,
          });
        }
      }
    } else {
      slideTitle(slide, theme, clip(slideInput.title, warnings, context, 80));
      const items = (slideInput.bullets || []).slice(0, PRESENTATION_MAX_BULLETS_PER_SLIDE).map((item) => clip(item, warnings, context, 140));
      if (items.length) {
        slide.addText(bulletText(items, theme), {
          x: MARGIN, y: MARGIN + 1.25, w: CONTENT_WIDTH, h: SLIDE_HEIGHT - MARGIN * 2 - 1.9,
          fontFace: theme.font, valign: 'top', lineSpacingMultiple: 1.25,
        });
      }
    }
    if (slideInput.notes?.trim()) slide.addNotes(String(slideInput.notes).slice(0, 4000));
    addFooter(slide, theme, index + 1, finalSlides.length);
  });

  const output = await pptx.write({ outputType: 'nodebuffer' });
  const buffer = Buffer.isBuffer(output) ? output : Buffer.from(output as ArrayBuffer);
  assertArchiveParts(buffer, ['ppt/presentation.xml', 'ppt/slides/slide1.xml'], 'PPT 演示文稿');
  return { buffer, warnings };
}

export function resolvePresentationFileName(rawName: unknown) {
  const base = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : 'SANMAO-演示文稿.pptx';
  return forceArtifactExtension(base, '.pptx');
}
