import { buildShareConversationLayout, type ShareConversationTextBlock } from '@/lib/share-conversation-layout';

export type ShareConversationRenderMessage = {
    id: string;
    role: 'user' | 'assistant';
    pending?: boolean;
    content?: string;
    images?: Array<{ url: string }>;
    references?: unknown[];
    files?: Array<{ name?: string }>;
};

type ShareConversationImageEntry = {
    messageIndex: number;
    imageIndex: number;
    item: { url: string };
};
function loadCanvasImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (/^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
        image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image) : reject(new Error('图片尺寸无效'));
        image.onerror = () => reject(new Error('参考图读取失败'));
        image.src = url;
    });
}
function containCanvasRect(sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number) {
    const scale = Math.min(width / Math.max(1, sourceWidth), height / Math.max(1, sourceHeight));
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale));
    const drawHeight = Math.max(1, Math.round(sourceHeight * scale));
    return {
        x: Math.round(x + (width - drawWidth) / 2),
        y: Math.round(y + (height - drawHeight) / 2),
        width: drawWidth,
        height: drawHeight
    };
}
function roundCanvasRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}
const SHARE_FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';
const SHARE_TITLE = '让灵感落地，把想法变成作品';
const SHARE_DISCLAIMER = '内容由 SANMAO.AI 生成，仅供参考';
function drawShareInlineText(context: CanvasRenderingContext2D, value: unknown, x: number, baseline: number, fontSize: number, color: string) {
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
    const tokens = [];
    let cursor = 0;
    let match;
    while(match = pattern.exec(String(value || ''))){
        if (match.index > cursor) tokens.push({ text: String(value).slice(cursor, match.index), kind: 'normal' });
        const token = match[0];
        tokens.push({ text: token.slice(token.startsWith('**') || token.startsWith('__') ? 2 : 1, -1), kind: token.startsWith('`') ? 'code' : token.startsWith('**') || token.startsWith('__') ? 'bold' : 'italic' });
        cursor = match.index + token.length;
    }
    if (cursor < String(value || '').length) tokens.push({ text: String(value).slice(cursor), kind: 'normal' });
    let drawX = x;
    tokens.forEach((token)=>{
        const weight = token.kind === 'bold' ? 800 : 500;
        context.font = `${weight} ${fontSize}px ${SHARE_FONT}`;
        const width = context.measureText(token.text).width;
        if (token.kind === 'code') {
            context.fillStyle = '#eef0ff';
            roundCanvasRect(context, drawX - 5, baseline - fontSize - 4, width + 10, fontSize + 10, 5);
            context.fill();
            context.fillStyle = '#5b50bc';
            context.font = `500 ${fontSize}px ui-monospace, SFMono-Regular, Consolas, monospace`;
        } else {
            context.fillStyle = token.kind === 'bold' ? '#182238' : color;
            if (token.kind === 'italic') context.font = `italic 500 ${fontSize}px ${SHARE_FONT}`;
        }
        context.fillText(token.text, drawX, baseline);
        drawX += width;
    });
}

function drawShareConversationBlock(context: CanvasRenderingContext2D, block: ShareConversationTextBlock, x: number, y: number, width: number) {
    const blockHeight = Math.max(1, block.lines.length) * block.lineHeight + block.gapAfter;
    if (block.type === 'code') {
        context.fillStyle = '#f1f3f8';
        roundCanvasRect(context, x, y - 20, width, blockHeight - 4, 10);
        context.fill();
    }
    if (block.type === 'quote') {
        context.fillStyle = '#8c80f6';
        roundCanvasRect(context, x, y - 18, 5, Math.max(30, block.lines.length * block.lineHeight), 3);
        context.fill();
    }
    block.lines.forEach((line, index)=>{
        const baseline = y + index * block.lineHeight + block.fontSize;
        const indent = block.type === 'list' ? 25 : block.type === 'quote' ? 17 : 0;
        if (block.type === 'list') {
            context.fillStyle = '#7568f5';
            context.font = `800 ${block.fontSize}px ${SHARE_FONT}`;
            context.fillText('•', x, baseline);
        }
        const color = block.type === 'heading' ? '#182238' : block.type === 'code' ? '#4e5b70' : block.type === 'quote' ? '#68758a' : '#465268';
        drawShareInlineText(context, line, x + indent, baseline, block.fontSize, color);
    });
    return blockHeight;
}

export async function renderShareConversationImage(messages: ShareConversationRenderMessage[]): Promise<{ blob: Blob; width: number; height: number }> {
    if (messages.some((message)=>message.pending)) throw new Error('请等待当前回答完成后再分享');
    const completedMessages = messages.filter((message)=>!message.pending && (message.content?.trim() || message.images?.length || message.references?.length || message.files?.length));
    if (!completedMessages.length) throw new Error('当前对话还没有可分享的已完成内容');
    const imageEntries: ShareConversationImageEntry[] = [];
    completedMessages.forEach((message, messageIndex)=>{
        (message.images || []).forEach((item, imageIndex)=>imageEntries.push({ messageIndex, imageIndex, item }));
    });
    const loaded = await Promise.all([
        ...imageEntries.map((entry)=>loadCanvasImage(entry.item.url)),
        loadCanvasImage('/brand-mark.png'),
        loadCanvasImage('/share-qr.png')
    ]);
    const generatedImages = loaded.slice(0, imageEntries.length);
    const brandImage = loaded[imageEntries.length];
    const qrImage = loaded[imageEntries.length + 1];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持分享长图生成');
    const measureText = (value: string, fontSize: number)=>{
        context.font = `500 ${fontSize}px ${SHARE_FONT}`;
        return context.measureText(value).width;
    };
    const layout = buildShareConversationLayout(completedMessages.map((message, index)=>({
        id: message.id,
        role: message.role,
        content: message.content,
        imageDimensions: (message.images || []).map((item, imageIndex)=>{
            const entry = imageEntries.find((candidate)=>candidate.messageIndex === index && candidate.imageIndex === imageIndex);
            const image = entry ? generatedImages[imageEntries.indexOf(entry)] : null;
            return { width: image?.naturalWidth || 1, height: image?.naturalHeight || 1 };
        }),
        referenceCount: message.references?.length || 0,
        fileCount: message.files?.length || 0
    })), measureText);
    if (layout.overflow) throw new Error('对话内容过长，暂时无法生成单张分享 PNG；请分段分享。');
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    context.fillStyle = '#eef1f6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(122, 108, 245, .08)';
    context.beginPath();
    context.arc(canvas.width - 30, 24, 170, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(53, 193, 151, .06)';
    context.beginPath();
    context.arc(45, layout.footerY - 70, 150, 0, Math.PI * 2);
    context.fill();

    const { padding } = layout;
    context.fillStyle = '#7568f5';
    context.font = `800 16px ${SHARE_FONT}`;
    context.fillText('SANMAO.AI  /  CONVERSATION', padding, 66);
    context.fillStyle = '#182238';
    context.font = `800 40px ${SHARE_FONT}`;
    context.fillText(SHARE_TITLE, padding, 126);
    context.fillStyle = '#7d8798';
    context.font = `500 17px ${SHARE_FONT}`;
    context.fillText(`${new Date().toLocaleDateString('zh-CN')}  ·  ${completedMessages.length} 条对话内容`, padding, 164);
    context.fillStyle = '#d8dce5';
    context.fillRect(padding, 198, layout.contentWidth, 1);

    layout.messageLayouts.forEach((messageLayout, messageIndex)=>{
        const message = completedMessages[messageIndex];
        context.fillStyle = messageLayout.role === 'user' ? '#e7e9ef' : '#ffffff';
        context.shadowColor = messageLayout.role === 'user' ? 'rgba(25,35,56,.05)' : 'rgba(25,35,56,.10)';
        context.shadowBlur = messageLayout.role === 'user' ? 14 : 22;
        context.shadowOffsetY = 7;
        roundCanvasRect(context, messageLayout.x, messageLayout.y, messageLayout.width, messageLayout.height, messageLayout.role === 'user' ? 22 : 20);
        context.fill();
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
        context.fillStyle = messageLayout.role === 'user' ? '#5e687a' : '#7568f5';
        context.font = `800 15px ${SHARE_FONT}`;
        context.fillText(messageLayout.role === 'user' ? '你' : 'SANMAO.AI', messageLayout.textX, messageLayout.y + 38);
        context.fillStyle = '#a0a8b6';
        context.font = `500 12px ${SHARE_FONT}`;
        context.fillText(messageLayout.role === 'user' ? '提问' : '智能回复', messageLayout.textX + (messageLayout.role === 'user' ? 27 : 93), messageLayout.y + 38);
        let blockY = messageLayout.textY;
        messageLayout.blocks.forEach((block)=>{
            blockY += drawShareConversationBlock(context, block, messageLayout.textX, blockY, messageLayout.textWidth);
        });
        messageLayout.media.forEach((slot)=>{
            const entry = imageEntries.find((candidate)=>candidate.messageIndex === messageIndex && candidate.imageIndex === slot.index);
            const image = entry ? generatedImages[imageEntries.indexOf(entry)] : null;
            context.fillStyle = '#f3f5f9';
            roundCanvasRect(context, slot.x, slot.y, slot.width, slot.height, 14);
            context.fill();
            if (image) {
                const imageRect = containCanvasRect(image.naturalWidth, image.naturalHeight, slot.x + 12, slot.y + 12, slot.width - 24, slot.height - 24);
                context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
            }
            context.fillStyle = '#ffffff';
            roundCanvasRect(context, slot.x + 12, slot.y + 12, 42, 24, 8);
            context.fill();
            context.fillStyle = '#596579';
            context.font = `700 12px ${SHARE_FONT}`;
            context.fillText(`图 ${slot.index + 1}`, slot.x + 21, slot.y + 29);
        });
        if (messageLayout.metaY) {
            const meta = [];
            if (message.references?.length) meta.push(`参考图 ${message.references.length} 张`);
            if (message.files?.length) meta.push(`附件 ${message.files.length} 个`);
            context.fillStyle = '#8a94a5';
            context.font = `500 13px ${SHARE_FONT}`;
            context.fillText(meta.join('   ·   '), messageLayout.textX, messageLayout.metaY);
        }
    });

    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(25,35,56,.08)';
    context.shadowBlur = 20;
    context.shadowOffsetY = 5;
    roundCanvasRect(context, padding, layout.footerY, layout.contentWidth, layout.footerHeight, 22);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.drawImage(brandImage, padding + 28, layout.footerY + 45, 76, 76);
    context.fillStyle = '#182238';
    context.font = `800 23px ${SHARE_FONT}`;
    context.fillText('SANMAO.AI', padding + 126, layout.footerY + 77);
    context.fillStyle = '#68758a';
    context.font = `500 16px ${SHARE_FONT}`;
    context.fillText('让创作更快一步，让灵感有迹可循', padding + 126, layout.footerY + 108);
    context.fillStyle = '#9aa3b1';
    context.font = `500 13px ${SHARE_FONT}`;
    context.fillText(SHARE_DISCLAIMER, padding + 28, layout.footerY + 173);
    const qrSize = 122;
    context.drawImage(qrImage, padding + layout.contentWidth - qrSize - 30, layout.footerY + 42, qrSize, qrSize);
    context.fillStyle = '#7d8798';
    context.font = `500 12px ${SHARE_FONT}`;
    context.textAlign = 'right';
    context.fillText('扫码了解 SANMAO.AI', padding + layout.contentWidth - 30, layout.footerY + 181);
    context.textAlign = 'left';
    const blob = await new Promise<Blob>((resolve, reject)=>canvas.toBlob((value)=>value ? resolve(value) : reject(new Error('分享长图导出失败')), 'image/png'));
    return { blob, width: canvas.width, height: canvas.height };
}
