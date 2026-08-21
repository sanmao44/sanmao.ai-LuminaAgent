export type ShareConversationRole = 'user' | 'assistant';

export type ShareConversationMessage = {
  id?: string;
  role: ShareConversationRole;
  content?: string;
  imageDimensions?: Array<{ width: number; height: number }>;
  referenceCount?: number;
  fileCount?: number;
};

export type ShareConversationTextBlock = {
  type: 'heading' | 'paragraph' | 'list' | 'quote' | 'code';
  lines: string[];
  level?: number;
  fontSize: number;
  lineHeight: number;
  gapAfter: number;
};

export type ShareConversationMediaSlot = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShareConversationMessageLayout = {
  id: string;
  role: ShareConversationRole;
  x: number;
  y: number;
  width: number;
  height: number;
  textX: number;
  textY: number;
  textWidth: number;
  blocks: ShareConversationTextBlock[];
  media: ShareConversationMediaSlot[];
  metaY?: number;
};

export type ShareConversationLayout = {
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  contentWidth: number;
  headerBottom: number;
  footerY: number;
  footerHeight: number;
  messageLayouts: ShareConversationMessageLayout[];
  overflow: boolean;
};

const DEFAULT_CANVAS_WIDTH = 1200;
const DEFAULT_PADDING = 68;
const MESSAGE_GAP = 24;
const MEDIA_GAP = 16;
const MEDIA_HEIGHT = 260;
const FOOTER_HEIGHT = 230;
const MAX_CANVAS_HEIGHT = 30_000;

function normalizeContent(value: unknown) {
  return String(value || '').replace(/\r\n?/g, '\n').trim();
}

function parseMarkdownBlocks(value: unknown) {
  const lines = normalizeContent(value).split('\n');
  const blocks: Array<{ type: ShareConversationTextBlock['type']; lines: string[]; level?: number }> = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(/^\s*```\s*([^\s]*)\s*$/);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: 'code', lines: code.length ? code : [''] });
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, lines: [heading[2].trim()] });
      index += 1;
      continue;
    }
    const list = line.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (list) {
      const listLines: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
        if (!item) break;
        listLines.push(item[1].trim());
        index += 1;
      }
      blocks.push({ type: 'list', lines: listLines });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, '').trim());
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }
    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim() &&
      !/^\s*```\s*([^\s]*)\s*$/.test(lines[index]) &&
      !/^\s*#{1,6}\s+/.test(lines[index]) &&
      !/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }
  return blocks.length ? blocks : [{ type: 'paragraph' as const, lines: [''] }];
}

export function wrapShareConversationText(value: unknown, measureText: (value: string, fontSize: number) => number, maxWidth: number, fontSize: number) {
  const text = String(value ?? '');
  if (!text) return [''];
  const output: string[] = [];
  let line = '';
  for (const character of Array.from(text)) {
    const candidate = `${line}${character}`;
    if (!line || measureText(candidate, fontSize) <= maxWidth) {
      line = candidate;
      continue;
    }
    const breakAt = Math.max(line.lastIndexOf(' '), line.lastIndexOf('\t'));
    if (breakAt > 0) {
      output.push(line.slice(0, breakAt).trimEnd());
      line = `${line.slice(breakAt + 1).trimStart()}${character}`;
    } else {
      output.push(line.trimEnd());
      line = character.trimStart();
    }
  }
  if (line || !output.length) output.push(line.trimEnd());
  return output;
}

function blockStyle(type: ShareConversationTextBlock['type'], level = 1) {
  if (type === 'heading') {
    const fontSize = level <= 2 ? 25 : level === 3 ? 20 : 17;
    return { fontSize, lineHeight: fontSize + 10, gapAfter: 12 };
  }
  if (type === 'code') return { fontSize: 15, lineHeight: 25, gapAfter: 15 };
  if (type === 'quote') return { fontSize: 16, lineHeight: 28, gapAfter: 14 };
  if (type === 'list') return { fontSize: 16, lineHeight: 29, gapAfter: 15 };
  return { fontSize: 17, lineHeight: 30, gapAfter: 15 };
}

function buildTextBlocks(value: unknown, measureText: (value: string, fontSize: number) => number, maxWidth: number) {
  return parseMarkdownBlocks(value).map((block) => {
    const style = blockStyle(block.type, block.level);
    const indent = block.type === 'list' ? 26 : block.type === 'quote' ? 18 : 0;
    const lines = block.lines.flatMap((line) => wrapShareConversationText(line, measureText, Math.max(80, maxWidth - indent), style.fontSize));
    return {
      ...block,
      lines,
      ...style,
    };
  });
}

function textBlocksHeight(blocks: ShareConversationTextBlock[]) {
  return blocks.reduce((height, block) => height + Math.max(1, block.lines.length) * block.lineHeight + block.gapAfter, 0);
}

export function buildShareConversationLayout(
  messages: ShareConversationMessage[],
  measureText: (value: string, fontSize: number) => number,
  options: { canvasWidth?: number; padding?: number } = {},
): ShareConversationLayout {
  const canvasWidth = options.canvasWidth ?? DEFAULT_CANVAS_WIDTH;
  const padding = options.padding ?? DEFAULT_PADDING;
  const contentWidth = canvasWidth - padding * 2;
  const headerBottom = 232;
  let cursorY = headerBottom;
  const messageLayouts: ShareConversationMessageLayout[] = [];

  messages.forEach((message, messageIndex) => {
    const role = message.role === 'user' ? 'user' : 'assistant';
    const x = role === 'user' ? padding + 188 : padding;
    const width = role === 'user' ? contentWidth - 188 : contentWidth;
    const innerPadding = role === 'user' ? 28 : 32;
    const textWidth = width - innerPadding * 2;
    const blocks = buildTextBlocks(message.content, measureText, textWidth);
    let contentHeight = 58 + textBlocksHeight(blocks);
    const media: ShareConversationMediaSlot[] = [];
    const imageCount = message.imageDimensions?.length || 0;
    if (imageCount) {
      const columns = Math.min(2, imageCount);
      const slotWidth = (textWidth - MEDIA_GAP * (columns - 1)) / columns;
      const mediaStartY = cursorY + contentHeight;
      for (let index = 0; index < imageCount; index += 1) {
        const column = index % columns;
        const row = Math.floor(index / columns);
        media.push({
          index,
          x: x + innerPadding + column * (slotWidth + MEDIA_GAP),
          y: mediaStartY + row * (MEDIA_HEIGHT + MEDIA_GAP),
          width: slotWidth,
          height: MEDIA_HEIGHT,
        });
      }
      contentHeight += Math.ceil(imageCount / columns) * MEDIA_HEIGHT + Math.max(0, Math.ceil(imageCount / columns) - 1) * MEDIA_GAP + 18;
    }
    if (message.referenceCount || message.fileCount) {
      contentHeight += 40;
    }
    const height = Math.max(116, Math.ceil(contentHeight + 28));
    const textY = cursorY + 32 + 42;
    const metaY = message.referenceCount || message.fileCount ? cursorY + height - 27 : undefined;
    messageLayouts.push({
      id: message.id || `message-${messageIndex}`,
      role,
      x,
      y: cursorY,
      width,
      height,
      textX: x + innerPadding,
      textY,
      textWidth,
      blocks,
      media,
      metaY,
    });
    cursorY += height + MESSAGE_GAP;
  });

  const footerY = cursorY;
  const canvasHeight = footerY + FOOTER_HEIGHT + padding;
  return {
    canvasWidth,
    canvasHeight,
    padding,
    contentWidth,
    headerBottom,
    footerY,
    footerHeight: FOOTER_HEIGHT,
    messageLayouts,
    overflow: canvasHeight > MAX_CANVAS_HEIGHT,
  };
}
