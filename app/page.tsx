// @ts-nocheck
'use client';
/* __next_internal_client_entry_do_not_use__ default auto */ import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import AngleConsole from '@/components/AngleConsole';
import ModelPicker from '@/components/ModelPicker';
import UpdateNotice from '@/components/UpdateNotice';
import { getProviderPreset, providerPresets } from '@/lib/provider-presets';
import { agnesBillingLabel } from '@/lib/agnes';
import AgnesConnectionGuide from '@/components/AgnesConnectionGuide';
import { listChatSessions, listGallery, loadImageDirectoryHandle, patchGalleryItem, removeChatSession, removeGalleryItems, replaceChatSessions, replaceGalleryItems, saveChatSession, saveGalleryItems, saveImageDirectoryHandle } from '@/lib/client-history';
import Link from 'next/link';
import MaskEditor from '@/components/MaskEditor';
import VideoStudio from '@/components/VideoStudio';
import SelectMenu from '@/components/SelectMenu';
import JimengProviderCard from '@/components/JimengProviderCard';
import JimengAccountSummary from '@/components/JimengAccountSummary';
import UpscaleConnectionGuide from '@/components/UpscaleConnectionGuide';
import VideoRecordCard from '@/components/VideoRecordCard';
import { getFavoriteModelIds, getLastModelCall, recordModelCall, setModelFavorite, subscribeModelPreferences } from '@/lib/model-preferences';
import { selectAutomaticModel } from '@/lib/model-selection';
import { filterModelsByActiveProviders, isProviderModelLibraryEnabled } from '@/lib/provider-availability';
import { normalizeReferenceRecords } from '@/lib/reference-images';
import { buildShareImageLayout, buildSharePromptPlan } from '@/lib/share-image-layout';
import { buildShareConversationLayout } from '@/lib/share-conversation-layout';
import { buildShareConversationGroups, flattenSelectedShareMessages } from '@/lib/share-conversation-selection';
import { buildContinuationPrompt, extractAgentDirections, extractChatDirections, isChatDirectionHeading, isImageContinuationRequest, latestAssistantImage, likelyImageGenerationRequest } from '@/lib/agent-web';
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock';
import { IMAGE_QUALITY_OPTIONS, IMAGE_RATIOS } from '@/lib/creation/settings';
import { compressReferenceDataUrl, optimizeCanvasUploadFile } from '@/lib/canvas/api';
import { loadImageDimensions, seedVrTargetSize } from '@/lib/canvas/upscale';
import { bootstrapWorkspace, startWorkspaceSync } from '@/lib/workspace';
const NAV_NOTICE_STORAGE_KEY = 'sanmao-nav-notices-v1';
const LAST_SECTION_STORAGE_KEY = 'sanmao-last-section';
const rememberedSections = [
    'agent',
    'video',
    'generate',
    'history',
    'logs',
    'models',
    'providers',
    'settings'
];
function isRememberedSection(value) {
    return value !== null && rememberedSections.includes(value);
}
function compareContainSize(image, viewport) {
    if (!viewport.width || !viewport.height) return {
        width: 0,
        height: 0
    };
    if (!image.width || !image.height) return {
        ...viewport
    };
    const scale = Math.min(viewport.width / image.width, viewport.height / image.height);
    return {
        width: Math.max(1, image.width * scale),
        height: Math.max(1, image.height * scale)
    };
}
const emptyState = {
    providers: [],
    models: [],
    upscaleConnections: [],
    upscaleModels: [],
    settings: {
        agentModelId: null,
        defaultImageModelId: null,
        defaultVideoModelId: null,
        defaultProviderId: null
    }
};
const ratios = [...IMAGE_RATIOS];
const ratioDescriptions = {
    自动: '单图匹配参考图，多图交给模型',
    '1:1': '方形',
    '16:9': '宽屏',
    '9:16': '竖屏',
    '4:3': '横向',
    '3:4': '纵向',
    '3:2': '相机横幅',
    '2:3': '相机竖幅',
    '5:4': '横向海报',
    '4:5': '竖向海报',
    '2:1': '全景',
    '1:2': '长竖图',
    '21:9': '超宽屏',
    '9:21': '超长竖屏',
    自定义: '输入宽高比例'
};
const examples = [
    '把一个简单想法变成专业生图提示词',
    '这个主题还能怎么玩？给我 3 个视觉方向',
    '让这个创意看起来更高级、更有质感',
    '我只说目标，创意、模型和出图都交给你'
];
const pageSizeOptions = [
    12,
    24,
    48,
    96
].map((value)=>({
        value: String(value),
        label: `每页 ${value} 张`
    }));
const generationLogPageSize = 16;
const qualityOptions = IMAGE_QUALITY_OPTIONS.map((item)=>({ value: item.value, label: item.label, meta: item.description }));
const upscaleScales = [
    1,
    2,
    3,
    4
];
const cloudUpscaleFormatOptions = [
    { value: 'png', label: 'PNG · 无损' },
    { value: 'jpg', label: 'JPG · 体积更小' },
    { value: 'bmp', label: 'BMP · 兼容性好' }
];
function isCloudUpscaleModel(model) {
    return model?.provider === 'tencent-ci' || model?.provider === 'aliyun-viapi';
}
function upscalePreviewDimensions(source, scale, model, targetSize = 'auto') {
    if (!source) return null;
    if (isCloudUpscaleModel(model)) return {
        width: Math.max(1, Math.round(source.width * scale)),
        height: Math.max(1, Math.round(source.height * scale))
    };
    return seedVrTargetSize(source.width, source.height, scale, targetSize);
}
const sizeTiers = [
    {
        value: '1k',
        label: '1K',
        longEdge: 1280
    },
    {
        value: '2k',
        label: '2K',
        longEdge: 2048
    },
    {
        value: '3k',
        label: '3K',
        longEdge: 3072
    },
    {
        value: '4k',
        label: '4K',
        longEdge: 3840
    }
];
function emptyProviderForm() {
    const preset = getProviderPreset('custom');
    return {
        name: preset.short,
        type: preset.type,
        platform: preset.value,
        baseUrl: preset.baseUrl,
        apiKey: '',
        modelsPath: '/models',
        chatPath: '/chat/completions',
        imageGenerationPath: '/images/generations',
        imageEditPath: '/images/edits',
        imageUpscalePath: '/images/edits',
        imageUpscaleStatusPath: '',
        responsesPath: '/responses',
        videoTransport: '',
        videoBaseUrl: '',
        videoTaskPath: '/v1/tasks',
        videoTaskStatusPath: '/v1/tasks/{id}',
        videoGenerationPath: '/v1/videos',
        videoModelsPath: '/v1/models',
        videoPricingPath: '/v1/pricing',
        videoApiKey: '',
        jimengCliPath: '',
        authHeader: 'Authorization',
        authPrefix: 'Bearer '
    };
}
function uid(prefix = 'id') {
    return `${prefix}-${crypto.randomUUID()}`;
}
function kindLabel(kind) {
    return kind === 'chat' ? '对话模型' : kind === 'image' ? '图片模型' : kind === 'video' ? '视频模型' : '未分类';
}
function typeLabel(type) {
    return type === 'google-gemini' ? '谷歌 Gemini' : '通用兼容接口';
}
function platformLabel(platform) {
    return providerPresets.find((item)=>item.value === platform)?.short || '自定义';
}
function sourceLabel(source) {
    return source === 'canvas' ? '画布生成' : source === 'agent' ? '助手生成' : source === 'edit' ? '图片修改' : source === 'upscale' ? '高清放大' : '直接生成';
}
function generationLogSourceLabel(log) {
    if (log.source === 'canvas') return '画布生成';
    if (log.mode === 'video') return log.operation === 'edit' ? '视频编辑' : log.operation === 'extend' ? '视频扩展' : '视频生成';
    if (log.mode === 'audio' || log.mediaKind === 'audio') return '音频生成';
    if (log.source === 'agent') return '助手生成';
    return log.mode === 'edit' ? '图片修改' : log.mode === 'upscale' ? '图片超分' : '工作台生成';
}
function generationMediaKind(log) {
    if (log.mediaKind === 'audio' || log.mode === 'audio') return 'audio';
    if (log.mediaKind === 'video' || log.mode === 'video') return 'video';
    return 'image';
}
function generationMediaLabel(kind) {
    return kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片';
}
function ratioFromDimensions(width, height) {
    if (!width || !height) return '未知';
    const actual = width / height;
    const candidates = ratios.filter((item)=>item.includes(':')).map((item)=>({
            item,
            value: Number(item.split(':')[0]) / Number(item.split(':')[1])
        }));
    return candidates.reduce((best, candidate)=>Math.abs(candidate.value - actual) < Math.abs(best.value - actual) ? candidate : best).item;
}
function exactRatioFromDimensions(width, height) {
    if (!width || !height) return '自动';
    const divisor = gcd(Math.round(width), Math.round(height));
    return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}
function ratioValue(ratio, customWidth = 1, customHeight = 1) {
    if (ratio === '自定义') return customWidth > 0 && customHeight > 0 ? customWidth / customHeight : 1;
    const [rawWidth, rawHeight] = ratio.split(':').map(Number);
    return rawWidth > 0 && rawHeight > 0 ? rawWidth / rawHeight : 1;
}
function ratioLabel(ratio, customWidth, customHeight) {
    return ratio === '自定义' && customWidth > 0 && customHeight > 0 ? `${customWidth}:${customHeight}` : ratio;
}
function resolutionFromDimensions(width, height) {
    const longEdge = Math.max(width, height);
    return longEdge <= 1536 ? '1K' : longEdge <= 2304 ? '2K' : longEdge <= 3072 ? '3K' : '4K';
}
function logResolutionLabel(log, spec) {
    return log.resolution || log.outputSize?.match(/^(1K|2K|3K|4K)/i)?.[1]?.toUpperCase() || spec?.resolution || '未记录';
}
function logOutputSizeLabel(log, spec) {
    return log.outputSize || (spec ? `${spec.width}×${spec.height}` : '尺寸未记录');
}
function logAspectRatioLabel(log, spec) {
    return log.aspectRatio || spec?.ratio || '比例未记录';
}
function logDurationTone(durationMs) {
    if (!durationMs) return 'unknown';
    return durationMs < 10000 ? 'fast' : durationMs < 30000 ? 'normal' : 'slow';
}
function formatTime(ts) {
    return new Date(ts).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
function nearest16(value) {
    return Math.max(256, Math.round(value / 16) * 16);
}
function gcd(a, b) {
    return b ? gcd(b, a % b) : a;
}
function reorderReferenceItems(items, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) return items;
    const next = [
        ...items
    ];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return items;
    next.splice(toIndex, 0, moved);
    return next;
}
function cropSourceRect(width, height, ratio) {
    if (ratio === '原图' || ratio === '自由') return {
        x: 0,
        y: 0,
        width,
        height
    };
    const [rawWidth, rawHeight] = ratio.split(':').map(Number);
    const targetRatio = rawWidth / rawHeight;
    const sourceRatio = width / height;
    if (sourceRatio > targetRatio) {
        const cropWidth = Math.max(1, Math.round(height * targetRatio));
        return {
            x: Math.floor((width - cropWidth) / 2),
            y: 0,
            width: cropWidth,
            height
        };
    }
    const cropHeight = Math.max(1, Math.round(width / targetRatio));
    return {
        x: 0,
        y: Math.floor((height - cropHeight) / 2),
        width,
        height: cropHeight
    };
}
function canvasRectForRatio(width, height, ratio) {
    if (ratio === '原图' || ratio === '自由') return {
        width,
        height
    };
    const [rawWidth, rawHeight] = ratio.split(':').map(Number);
    const targetRatio = rawWidth / rawHeight;
    const sourceRatio = width / height;
    if (sourceRatio > targetRatio) return {
        width,
        height: Math.max(1, Math.round(width / targetRatio))
    };
    return {
        width: Math.max(1, Math.round(height * targetRatio)),
        height
    };
}
function drawCoverImage(context, image, sourceWidth, sourceHeight, targetWidth, targetHeight) {
    const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = Math.ceil(sourceWidth * scale);
    const height = Math.ceil(sourceHeight * scale);
    context.drawImage(image, (targetWidth - width) / 2, (targetHeight - height) / 2, width, height);
}
function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
async function renderOutpaintWhiteCanvas(url, layout) {
    const source = new Image();
    if (/^https?:/i.test(url)) source.crossOrigin = 'anonymous';
    await new Promise((resolve, reject)=>{
        source.onload = ()=>resolve();
        source.onerror = ()=>reject(new Error('无法读取这张图片，可能是远程图片未开放浏览器处理权限'));
        source.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持本地扩图处理');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, layout.offsetX, layout.offsetY, layout.sourceWidth, layout.sourceHeight);
    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
    };
}
async function renderLocalImage(url, mode, ratio, background, flipX, rotation, selectedCrop) {
    const source = new Image();
    if (/^https?:/i.test(url)) source.crossOrigin = 'anonymous';
    await new Promise((resolve, reject)=>{
        source.onload = ()=>resolve();
        source.onerror = ()=>reject(new Error('无法读取这张图片，可能是远程图片未开放浏览器处理权限'));
        source.src = url;
    });
    const rawCrop = mode === 'crop' && selectedCrop ? selectedCrop : mode === 'crop' ? cropSourceRect(source.naturalWidth, source.naturalHeight, ratio) : {
        x: 0,
        y: 0,
        width: source.naturalWidth,
        height: source.naturalHeight
    };
    const crop = {
        x: Math.round(rawCrop.x),
        y: Math.round(rawCrop.y),
        width: Math.max(1, Math.round(rawCrop.width)),
        height: Math.max(1, Math.round(rawCrop.height))
    };
    const swap = rotation === 90 || rotation === 270;
    const transformed = document.createElement('canvas');
    transformed.width = swap ? crop.height : crop.width;
    transformed.height = swap ? crop.width : crop.height;
    const context = transformed.getContext('2d');
    if (!context) throw new Error('当前浏览器不支持本地图片处理');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.translate(transformed.width / 2, transformed.height / 2);
    context.rotate(rotation * Math.PI / 180);
    context.scale(flipX ? -1 : 1, 1);
    context.drawImage(source, crop.x, crop.y, crop.width, crop.height, -crop.width / 2, -crop.height / 2, crop.width, crop.height);
    if (mode === 'crop' || ratio === '原图') return {
        dataUrl: transformed.toDataURL('image/png'),
        width: transformed.width,
        height: transformed.height
    };
    const target = canvasRectForRatio(transformed.width, transformed.height, ratio);
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const output = canvas.getContext('2d');
    if (!output) throw new Error('当前浏览器不支持本地图片处理');
    output.imageSmoothingEnabled = true;
    output.imageSmoothingQuality = 'high';
    if (background === 'white' || background === 'black') {
        output.fillStyle = background === 'white' ? '#ffffff' : '#050507';
        output.fillRect(0, 0, canvas.width, canvas.height);
    } else if (background === 'blur') {
        output.save();
        output.filter = 'blur(26px)';
        drawCoverImage(output, transformed, transformed.width, transformed.height, canvas.width, canvas.height);
        output.restore();
        output.fillStyle = 'rgba(255,255,255,.06)';
        output.fillRect(0, 0, canvas.width, canvas.height);
    }
    output.drawImage(transformed, Math.round((canvas.width - transformed.width) / 2), Math.round((canvas.height - transformed.height) / 2));
    return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height
    };
}
function presetDimensions(ratio, tier, customRatioWidth = 1, customRatioHeight = 1) {
    const longEdge = sizeTiers.find((item)=>item.value === tier)?.longEdge || 1280;
    const value = ratioValue(ratio, customRatioWidth, customRatioHeight);
    if (value >= 1) return {
        width: longEdge,
        height: nearest16(longEdge / value)
    };
    return {
        width: nearest16(longEdge * value),
        height: longEdge
    };
}
function outputDimensions(outputSize) {
    const match = outputSize?.match(/(\d+)\s*[x×]\s*(\d+)/i);
    return match ? {
        width: Number(match[1]),
        height: Number(match[2])
    } : null;
}
function sizeTierFromDimensions(width, height) {
    const longEdge = Math.max(width, height);
    return longEdge > 3072 ? '4k' : longEdge > 2304 ? '3k' : longEdge > 1536 ? '2k' : '1k';
}
function editorRatio(editor) {
    if (editor.ratio !== '自动') return editor.ratio;
    const dimensions = outputDimensions(editor.item.outputSize);
    return dimensions ? exactRatioFromDimensions(dimensions.width, dimensions.height) : '1:1';
}
async function fileToReference(file, options) {
    if (!file.type.startsWith('image/')) throw new Error('只能上传图片文件');
    const prepared = await optimizeCanvasUploadFile(file);
    const sourceFile = prepared.file;
    const rawDataUrl = await new Promise((resolve, reject)=>{
        const reader = new FileReader();
        reader.onload = ()=>resolve(String(reader.result || ''));
        reader.onerror = ()=>reject(new Error('读取图片失败'));
        reader.readAsDataURL(sourceFile);
    });
    const dataUrl = options?.compressForChat ? await compressReferenceDataUrl(rawDataUrl) : rawDataUrl;
    return {
        id: uid('ref'),
        name: file.name || '参考图',
        dataUrl,
        optimized: prepared.changed,
        originalSize: prepared.originalSize,
        uploadedSize: prepared.uploadedSize
    };
}
const textAttachmentExtensions = new Set([
    'txt',
    'md',
    'markdown',
    'json',
    'csv',
    'tsv',
    'html',
    'htm',
    'css',
    'js',
    'jsx',
    'ts',
    'tsx',
    'py',
    'java',
    'sql',
    'xml',
    'svg',
    'yaml',
    'yml',
    'sh',
    'ps1'
]);
async function fileToChatFile(file) {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    if (!file.type.startsWith('text/') && !textAttachmentExtensions.has(extension) && ![
        'application/json',
        'application/xml',
        'image/svg+xml'
    ].includes(file.type)) throw new Error(`${file.name} 暂不支持直接分析，请先转换为 TXT、Markdown、JSON 或 CSV`);
    if (file.size > 2 * 1024 * 1024) throw new Error(`${file.name} 超过 2MB，请先拆分文件`);
    const content = await file.text();
    if (!content.trim()) throw new Error(`${file.name} 没有可读取的文字内容`);
    return {
        id: uid('file'),
        name: file.name || '上传文件.txt',
        mimeType: file.type || 'text/plain;charset=utf-8',
        content,
        encoding: 'utf8',
        size: file.size
    };
}
function clipboardImageFiles(data) {
    return Array.from(data.items || []).filter((item)=>item.kind === 'file' && item.type.startsWith('image/')).map((item)=>item.getAsFile()).filter((file)=>Boolean(file));
}
async function makeWhiteBackgroundTransparent(image) {
    const source = new Image();
    if (/^https?:/i.test(image.url)) source.crossOrigin = 'anonymous';
    await new Promise((resolve, reject)=>{
        source.onload = ()=>resolve();
        source.onerror = ()=>reject(new Error('图片读取失败'));
        source.src = image.url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = source.naturalWidth;
    canvas.height = source.naturalHeight;
    const context = canvas.getContext('2d', {
        willReadFrequently: true
    });
    if (!context) throw new Error('浏览器不支持本地透明处理');
    context.drawImage(source, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    for(let i = 0; i < pixels.data.length; i += 4){
        const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
        const min = Math.min(r, g, b), max = Math.max(r, g, b);
        if (min > 218 && max - min < 24) pixels.data[i + 3] = Math.min(pixels.data[i + 3], Math.max(0, Math.round((255 - min) / 37 * 255)));
    }
    context.putImageData(pixels, 0, 0);
    return {
        ...image,
        url: canvas.toDataURL('image/png')
    };
}
async function downloadUrl(url, filename) {
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('fetch failed');
        const blob = await response.blob();
        const actualExtension = blob.type.includes('jpeg') ? 'jpg' : blob.type.includes('webp') ? 'webp' : blob.type.includes('png') ? 'png' : '';
        if (actualExtension) filename = filename.replace(/\.(png|jpe?g|webp)$/i, `.${actualExtension}`);
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.setTimeout(()=>URL.revokeObjectURL(objectUrl), 1500);
    } catch  {
        const dataExtension = url.match(/^data:image\/(png|jpeg|webp)/i)?.[1];
        if (dataExtension) filename = filename.replace(/\.(png|jpe?g|webp)$/i, `.${dataExtension === 'jpeg' ? 'jpg' : dataExtension}`);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.target = '_blank';
        a.rel = 'noreferrer';
        document.body.appendChild(a);
        a.click();
        a.remove();
    }
}
function galleryReferences(item) {
    const references = normalizeReferenceRecords(item?.references, { keepDataUrls: true });
    if (references.length) return references;
    if (item?.compareReferenceUrl) return [{
        id: `reference-${item.id}`,
        name: item.compareReferenceName || '上传参考图',
        url: item.compareReferenceUrl
    }];
    return [];
}
function referenceCount(item) {
    return galleryReferences(item).length;
}
function truncateCanvasText(value, max = 28) {
    const text = String(value || '').trim();
    return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}
function loadCanvasImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        if (/^https?:\/\//i.test(url)) image.crossOrigin = 'anonymous';
        image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve(image) : reject(new Error('图片尺寸无效'));
        image.onerror = () => reject(new Error('参考图读取失败'));
        image.src = url;
    });
}
function containCanvasRect(sourceWidth, sourceHeight, x, y, width, height) {
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
function roundCanvasRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
}
function drawCanvasPill(context, x, y, width, height, fill, stroke) {
    roundCanvasRect(context, x, y, width, height, height / 2);
    context.fillStyle = fill;
    context.fill();
    if (stroke) {
        roundCanvasRect(context, x, y, width, height, height / 2);
        context.strokeStyle = stroke;
        context.lineWidth = 1;
        context.stroke();
    }
}
function drawCanvasImageContain(context, image, x, y, width, height, radius = 0) {
    const imageRect = containCanvasRect(image.naturalWidth, image.naturalHeight, x, y, width, height);
    context.save();
    if (radius > 0) {
        roundCanvasRect(context, x, y, width, height, radius);
        context.clip();
    }
    context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    context.restore();
    return imageRect;
}
async function downloadShareImage(item) {
    const references = galleryReferences(item);
    if (!references.length) throw new Error('这张图片没有保存参考图，无法生成分享版');
    const images = await Promise.all([
        loadCanvasImage(item.url),
        ...references.map((reference) => loadCanvasImage(reference.url)),
        loadCanvasImage('/brand-mark.png'),
        loadCanvasImage('/share-qr.png')
    ]);
    const resultImage = images[0];
    const referenceImages = images.slice(1, references.length + 1);
    const brandImage = images[references.length + 1];
    const qrImage = images[references.length + 2];
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('浏览器不支持分享版图片生成');
    const shareFont = '"Segoe UI", "Microsoft YaHei", sans-serif';
    const promptMeasure = (value, fontSize = 22) => {
        context.font = `500 ${fontSize}px ${shareFont}`;
        return context.measureText(value).width;
    };
    const promptPlan = buildSharePromptPlan(item.prompt || '', promptMeasure, 1232);
    const layout = buildShareImageLayout({
        resultWidth: resultImage.naturalWidth,
        resultHeight: resultImage.naturalHeight,
        promptPlan,
        referenceCount: references.length,
    });
    if (layout.overflow) throw new Error('提示词过长，无法在单张分享 PNG 中完整排版；请在应用内复制提示词后分享。');
    canvas.width = layout.canvasWidth;
    canvas.height = layout.canvasHeight;
    context.fillStyle = '#eef1f6';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const backgroundGlow = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    backgroundGlow.addColorStop(0, 'rgba(117, 104, 245, .08)');
    backgroundGlow.addColorStop(.42, 'rgba(255, 255, 255, 0)');
    backgroundGlow.addColorStop(1, 'rgba(53, 193, 151, .08)');
    context.fillStyle = backgroundGlow;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(117, 104, 245, .08)';
    context.beginPath();
    context.arc(canvas.width - 18, 30, 180, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = 'rgba(53, 193, 151, .06)';
    context.beginPath();
    context.arc(35, layout.footerY + 100, 180, 0, Math.PI * 2);
    context.fill();

    const logoSize = 60;
    context.shadowColor = 'rgba(25,35,56,.16)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 6;
    roundCanvasRect(context, layout.padding, 28, logoSize, logoSize, 16);
    context.fillStyle = '#08090d';
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    drawCanvasImageContain(context, brandImage, layout.padding, 28, logoSize, logoSize, 16);
    context.fillStyle = '#182238';
    context.font = `800 30px ${shareFont}`;
    context.fillText('SANMAO.AI', layout.padding + 80, 54);
    context.fillStyle = '#68758a';
    context.font = `500 15px ${shareFont}`;
    context.fillText('AI 创作工作台  ·  IMAGE SHARE', layout.padding + 82, 80);
    const headerPillWidth = 270;
    const headerPillX = canvas.width - layout.padding - headerPillWidth;
    drawCanvasPill(context, headerPillX, 34, headerPillWidth, 42, 'rgba(255,255,255,.78)', '#d9deea');
    context.fillStyle = '#7568f5';
    context.font = `800 11px ${shareFont}`;
    context.fillText('IMAGE / RESULT', headerPillX + 18, 52);
    context.fillStyle = '#7d8798';
    context.font = `500 11px ${shareFont}`;
    context.textAlign = 'right';
    context.fillText(new Date(item.createdAt).toLocaleDateString('zh-CN'), headerPillX + headerPillWidth - 18, 52);
    context.textAlign = 'left';
    context.fillStyle = '#9aa3b1';
    context.font = `500 11px ${shareFont}`;
    context.fillText('GENERATIVE IMAGE  ·  SANMAO.AI', headerPillX + 18, 67);

    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(25,35,56,.12)';
    context.shadowBlur = 24;
    context.shadowOffsetY = 8;
    roundCanvasRect(context, layout.resultFrame.x, layout.resultFrame.y, layout.resultFrame.width, layout.resultFrame.height, 20);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = '#192338';
    context.font = `800 12px ${shareFont}`;
    context.fillText('GENERATED IMAGE', layout.resultFrame.x + 28, layout.resultFrame.y + 18);
    context.fillStyle = '#9aa3b1';
    context.font = `500 12px ${shareFont}`;
    context.textAlign = 'right';
    context.fillText(`${truncateCanvasText(item.modelName || '图片模型', 42)}  ·  ${new Date(item.createdAt).toLocaleString('zh-CN', { hour12: false })}`, layout.resultFrame.x + layout.resultFrame.width - 28, layout.resultFrame.y + 18);
    context.textAlign = 'left';
    drawCanvasImageContain(context, resultImage, layout.resultContent.x, layout.resultContent.y, layout.resultContent.width, layout.resultContent.height, 12);
    context.strokeStyle = '#e4e7ef';
    context.lineWidth = 1;
    roundCanvasRect(context, layout.resultContent.x, layout.resultContent.y, layout.resultContent.width, layout.resultContent.height, 12);
    context.stroke();
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(25,35,56,.08)';
    context.shadowBlur = 18;
    context.shadowOffsetY = 5;
    roundCanvasRect(context, layout.promptFrame.x, layout.promptFrame.y, layout.promptFrame.width, layout.promptFrame.height, 18);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = '#7568f5';
    roundCanvasRect(context, layout.promptFrame.x + 28, layout.promptFrame.y + 24, 6, 30, 3);
    context.fill();
    context.fillStyle = '#192338';
    context.font = `700 22px ${shareFont}`;
    context.fillText('提示词', layout.promptFrame.x + 50, layout.promptFrame.y + 48);
    context.fillStyle = '#8792a3';
    context.font = `500 13px ${shareFont}`;
    context.fillText('用户提交内容', layout.promptFrame.x + 50, layout.promptFrame.y + 70);
    const promptStartY = layout.promptFrame.y + 98;
    const promptStartX = layout.promptFrame.x + 28;
    const promptColumnWidth = promptPlan.columnWidth;
    promptPlan.columns.forEach((column, columnIndex) => {
        const x = promptStartX + columnIndex * (promptColumnWidth + promptPlan.columnGap);
        let y = promptStartY;
        context.fillStyle = '#526075';
        context.font = `500 ${promptPlan.fontSize}px ${shareFont}`;
        column.forEach((line) => {
            if (!line) {
                y += promptPlan.lineHeight + promptPlan.paragraphGap;
                return;
            }
            context.fillText(line, x, y + promptPlan.fontSize);
            y += promptPlan.lineHeight;
        });
    });
    context.fillStyle = '#192338';
    context.font = `700 23px ${shareFont}`;
    context.fillText(`参考图（按提交顺序 · ${references.length} 张）`, layout.padding, layout.referenceHeadingY + 24);
    const tileWidth = layout.referenceTileWidth;
    const tileHeight = layout.referenceTileHeight;
    const tileGap = layout.referenceTileGap;
    references.forEach((reference, index) => {
        const column = index % layout.referenceColumns;
        const row = Math.floor(index / layout.referenceColumns);
        const x = layout.padding + column * (tileWidth + tileGap);
        const y = layout.referenceTilesY + row * (tileHeight + tileGap);
        context.fillStyle = '#ffffff';
        context.shadowColor = 'rgba(25,35,56,.08)';
        context.shadowBlur = 14;
        context.shadowOffsetY = 4;
        roundCanvasRect(context, x, y, tileWidth, tileHeight, 14);
        context.fill();
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
        context.shadowOffsetY = 0;
        const referenceImage = referenceImages[index];
        drawCanvasImageContain(context, referenceImage, x + 12, y + 12, tileWidth - 24, 132, 10);
        context.strokeStyle = '#e6e9f0';
        context.lineWidth = 1;
        roundCanvasRect(context, x + 12, y + 12, tileWidth - 24, 132, 10);
        context.stroke();
        context.fillStyle = '#526075';
        context.font = `700 16px ${shareFont}`;
        context.fillText(`图 ${index + 1}`, x + 12, y + 163);
        context.fillStyle = '#7b8798';
        context.font = `500 14px ${shareFont}`;
        context.fillText(truncateCanvasText(reference.name, 18), x + 58, y + 163);
    });

    const footerX = layout.padding;
    const footerY = layout.footerY;
    const footerWidth = layout.contentWidth;
    context.fillStyle = '#ffffff';
    context.shadowColor = 'rgba(25,35,56,.10)';
    context.shadowBlur = 22;
    context.shadowOffsetY = 7;
    roundCanvasRect(context, footerX, footerY, footerWidth, layout.footerHeight, 22);
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    const footerAccent = context.createLinearGradient(footerX, footerY, footerX + footerWidth, footerY);
    footerAccent.addColorStop(0, '#7568f5');
    footerAccent.addColorStop(1, '#35c197');
    context.fillStyle = footerAccent;
    roundCanvasRect(context, footerX, footerY, footerWidth, 6, 3);
    context.fill();
    const footerLogoSize = 76;
    context.fillStyle = '#08090d';
    roundCanvasRect(context, footerX + 30, footerY + 40, footerLogoSize, footerLogoSize, 18);
    context.fill();
    drawCanvasImageContain(context, brandImage, footerX + 30, footerY + 40, footerLogoSize, footerLogoSize, 18);
    context.fillStyle = '#182238';
    context.font = `800 25px ${shareFont}`;
    context.fillText('让灵感落地，把想法变成作品', footerX + 132, footerY + 72);
    context.fillStyle = '#7568f5';
    context.font = `800 15px ${shareFont}`;
    context.fillText('SANMAO.AI  ·  AI 创作工作台', footerX + 132, footerY + 101);
    context.fillStyle = '#68758a';
    context.font = `500 14px ${shareFont}`;
    context.fillText('从提示词到成片，让每一次创作都有迹可循。', footerX + 132, footerY + 130);
    context.fillStyle = '#9aa3b1';
    context.font = `500 12px ${shareFont}`;
    context.fillText('内容由 SANMAO.AI 生成，仅供参考', footerX + 30, footerY + layout.footerHeight - 24);

    const qrPanelWidth = layout.footerQrSize + 28;
    const qrPanelHeight = layout.footerHeight - 28;
    const qrPanelX = footerX + footerWidth - qrPanelWidth - 24;
    const qrPanelY = footerY + 14;
    roundCanvasRect(context, qrPanelX, qrPanelY, qrPanelWidth, qrPanelHeight, 18);
    context.fillStyle = '#f7f8fb';
    context.fill();
    context.strokeStyle = '#e2e6ef';
    context.lineWidth = 1;
    roundCanvasRect(context, qrPanelX, qrPanelY, qrPanelWidth, qrPanelHeight, 18);
    context.stroke();
    context.fillStyle = '#182238';
    context.font = `800 13px ${shareFont}`;
    context.textAlign = 'center';
    context.fillText('扫码访问 SANMAO.AI', qrPanelX + qrPanelWidth / 2, qrPanelY + 20);
    drawCanvasImageContain(context, qrImage, qrPanelX + 14, qrPanelY + 27, layout.footerQrSize, qrPanelHeight - 36, 8);
    context.textAlign = 'left';
    const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('分享版图片导出失败')), 'image/png'));
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `SANMAO-${item.id}-分享版.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
}
const SHARE_FONT = '"Segoe UI", "Microsoft YaHei", sans-serif';
const SHARE_TITLE = '让灵感落地，把想法变成作品';
const SHARE_DISCLAIMER = '内容由 SANMAO.AI 生成，仅供参考';

function drawShareInlineText(context, value, x, baseline, fontSize, color) {
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

function drawShareConversationBlock(context, block, x, y, width) {
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

async function renderShareConversationImage(messages) {
    if (messages.some((message)=>message.pending)) throw new Error('请等待当前回答完成后再分享');
    const completedMessages = messages.filter((message)=>!message.pending && (message.content?.trim() || message.images?.length || message.references?.length || message.files?.length));
    if (!completedMessages.length) throw new Error('当前对话还没有可分享的已完成内容');
    const imageEntries = [];
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
    const measureText = (value, fontSize)=>{
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
    const blob = await new Promise((resolve, reject)=>canvas.toBlob((value)=>value ? resolve(value) : reject(new Error('分享长图导出失败')), 'image/png'));
    return { blob, width: canvas.width, height: canvas.height };
}
async function downloadChatFile(file) {
    const blob = file.encoding === 'base64' ? new Blob([
        Uint8Array.from(atob(file.content.replace(/\s/g, '')), (char)=>char.charCodeAt(0))
    ], {
        type: file.mimeType || 'application/octet-stream'
    }) : new Blob([
        file.content
    ], {
        type: file.mimeType || 'text/plain;charset=utf-8'
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = file.name || 'SANMAO-file.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(()=>URL.revokeObjectURL(objectUrl), 1500);
}
function formatFileSize(size) {
    if (!size || size < 1) return '文件';
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
async function readAgentStream(response, onEvent, signal) {
    if (!response.body) throw new Error('助手没有返回可读取的流');
    const reader = response.body.getReader();
    const cancelReader = ()=>{
        void reader.cancel().catch(()=>undefined);
    };
    if (signal?.aborted) cancelReader();
    else signal?.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder();
    let buffer = '';
    let final = {};
    const consume = (raw)=>{
        buffer += raw;
        const chunks = buffer.split(/\n\n/);
        buffer = chunks.pop() || '';
        for (const chunk of chunks){
            const dataLine = chunk.split(/\n/).find((line)=>line.startsWith('data:'));
            if (!dataLine) continue;
            const rawData = dataLine.slice(5).trim();
            if (!rawData || rawData === '[DONE]') continue;
            try {
                const event = JSON.parse(rawData);
                if (event.type === 'final') final = event;
                onEvent(event);
            } catch  {}
        }
    };
    try {
        while(true){
            const part = await reader.read();
            if (part.done) break;
            consume(decoder.decode(part.value, {
                stream: true
            }));
        }
        consume(decoder.decode());
    } finally {
        signal?.removeEventListener('abort', cancelReader);
    }
    if (signal?.aborted) throw signal.reason || new Error('AGENT_CANCELLED');
    return final;
}
async function requestPromptOptimization(source, model, references = []) {
    const response = await fetch('/api/agent', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [
                {
                    role: 'user',
                    content: source,
                    references,
                    files: []
                }
            ],
            model,
            task: 'optimize_prompt',
            stream: true
        })
    });
    let data;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
        let streamedText = '';
        const final = await readAgentStream(response, (event)=>{
            if (event.type === 'delta') streamedText += String(event.text || '');
            if (event.type === 'error') throw new Error(event.message || 'AI 优化失败');
        });
        data = {
            ...final,
            message: final.message || streamedText
        };
    } else data = await response.json();
    if (!response.ok) throw new Error(data.error || 'AI 优化失败');
    const optimized = String(data.message || '').trim();
    if (!optimized) throw new Error('助手没有返回优化后的文案');
    return optimized;
}
function Icon({ name, size = 18 }) {
    const paths = {
        agent: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 3l1.1 3.1L16 7.2l-2.9 1.1L12 11.5l-1.1-3.2L8 7.2l2.9-1.1L12 3Z"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M6.5 12.5l.7 2 1.8.7-1.8.7-.7 2-.7-2-1.8-.7 1.8-.7.7-2Z"
                                                     })
                                                 ]
        }),
        image: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "3",
                    y: "4",
                    width: "18",
                    height: "16",
                    rx: "3"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m6 16 4-4 3 3 2-2 3 3"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "8",
                    cy: "9",
                    r: "1.4"
                })
            ]
        }),
        video: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "3",
                    y: "5",
                    width: "13",
                    height: "14",
                    rx: "3"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m16 10 5-3v10l-5-3Z"
                })
            ]
        }),
        audio: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M9 18V6l10-2v12"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "6.5",
                    cy: "18",
                    r: "2.5"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "16.5",
                    cy: "16",
                    r: "2.5"
                })
            ]
        }),
        canvas: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "3.5",
                    y: "3.5",
                    width: "7",
                    height: "7",
                    rx: "1.6"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "13.5",
                    y: "3.5",
                    width: "7",
                    height: "7",
                    rx: "1.6"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "3.5",
                    y: "13.5",
                    width: "7",
                    height: "7",
                    rx: "1.6"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "13.5",
                    y: "13.5",
                    width: "7",
                    height: "7",
                    rx: "1.6"
                })
            ]
        }),
        menu: /*#__PURE__*/ _jsx(_Fragment, {
            children: /*#__PURE__*/ _jsx("path", {
                d: "M4 7h16M4 12h16M4 17h16"
            })
        }),
        history: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M4 7h10a6 6 0 1 1-5.4 8.6"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M4 7 7 4M4 7l3 3"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M14 9v4l2.5 1.5"
                })
            ]
        }),
        logs: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "5",
                    y: "3.5",
                    width: "14",
                    height: "17",
                    rx: "2"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M8.5 8h7M8.5 12h7M8.5 16h4.5"
                })
            ]
        }),
        model: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "4",
                    y: "4",
                    width: "6",
                    height: "6",
                    rx: "1.5"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "14",
                    y: "4",
                    width: "6",
                    height: "6",
                    rx: "1.5"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "4",
                    y: "14",
                    width: "6",
                    height: "6",
                    rx: "1.5"
                }),
                /*#__PURE__*/ _jsx("rect", {
                    x: "14",
                    y: "14",
                    width: "6",
                    height: "6",
                    rx: "1.5"
                })
            ]
        }),
        plug: /*#__PURE__*/ _jsx(_Fragment, {
            children: /*#__PURE__*/ _jsx("path", {
                d: "M8 3v5M16 3v5M6 8h12v2a6 6 0 0 1-6 6v5"
            })
        }),
        plus: /*#__PURE__*/ _jsx("path", {
            d: "M12 5v14M5 12h14"
        }),
        sun: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "3.5"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"
                })
            ]
        }),
        moon: /*#__PURE__*/ _jsx("path", {
            d: "M20 15.2A8.4 8.4 0 0 1 8.8 4 8.5 8.5 0 1 0 20 15.2Z"
        }),
        upload: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 16V4M7 9l5-5 5 5"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M5 14v5h14v-5"
                })
            ]
        }),
        send: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "m4 5 16 7-16 7 3-7-3-7Z"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M7 12h13"
                })
            ]
        }),
        stop: /*#__PURE__*/ _jsx("rect", {
            x: "7",
            y: "7",
            width: "10",
            height: "10",
            rx: "1.5"
        }),
        download: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 3v12M7 10l5 5 5-5"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M4 19h16"
                })
            ]
        }),
        share: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", { cx: "18", cy: "5", r: "2.5" }),
                /*#__PURE__*/ _jsx("circle", { cx: "6", cy: "12", r: "2.5" }),
                /*#__PURE__*/ _jsx("circle", { cx: "18", cy: "19", r: "2.5" }),
                /*#__PURE__*/ _jsx("path", { d: "m8.3 10.8 7.4-4.3M8.3 13.2l7.4 4.3" })
            ]
        }),
        trash: /*#__PURE__*/ _jsx(_Fragment, {
            children: /*#__PURE__*/ _jsx("path", {
                d: "M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M6 7l1 14h10l1-14"
            })
        }),
        folder: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M3.5 7.5h6l1.7 2h9.3v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-8.5a2 2 0 0 1 2-2Z"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M3.5 7.5v-1a2 2 0 0 1 2-2h4l1.7 2h5.3"
                })
            ]
        }),
        reuse: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M7 7h10v10H7z"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M4 14V4h10M10 20h10V10"
                })
            ]
        }),
        retry: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M20 11a8 8 0 1 0 1 4"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M20 4v7h-7"
                })
            ]
        }),
        edit: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "m4 17-.7 3.7L7 20l10.8-10.8-3-3L4 17Z"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m13.8 7.2 3 3"
                })
            ]
        }),
        adjust: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M4 7h10M18 7h2M4 17h2M10 17h10"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "16",
                    cy: "7",
                    r: "2"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "8",
                    cy: "17",
                    r: "2"
                })
            ]
        }),
        settings: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "3"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.6V20a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.6-1H6v-2.6h.4A1.7 1.7 0 0 0 8 10a1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6v-.2H15V5a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2V14H21a1.7 1.7 0 0 0-1.6 1Z"
                })
            ]
        }),
        wechat: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M10 4.5c-4 0-7.3 2.4-7.3 5.5 0 1.7 1 3.2 2.5 4.2l-.7 2.6 2.8-1.5c.8.2 1.7.3 2.7.3 3.9 0 7.1-2.3 7.1-5.4S14 4.5 10 4.5Z",
                    fill: "currentColor",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M14.5 9.1c3.7.2 6.4 2.3 6.4 5.1 0 1.2-.5 2.3-1.4 3.2l.5 2-2.4-1.3c-.7.2-1.4.3-2.1.3-3.3 0-5.9-1.9-6.3-4.4 2.8-.4 4.9-2.2 5.3-4.9Z",
                    fill: "currentColor",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "7.2",
                    cy: "10",
                    r: ".8",
                    fill: "#16a05d",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "11.9",
                    cy: "10",
                    r: ".8",
                    fill: "#16a05d",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "13.5",
                    cy: "14.6",
                    r: ".7",
                    fill: "#16a05d",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "17.6",
                    cy: "14.6",
                    r: ".7",
                    fill: "#16a05d",
                    stroke: "none"
                })
            ]
        }),
        star: /*#__PURE__*/ _jsx("path", {
            d: "m12 3 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9L12 3Z"
        }),
        close: /*#__PURE__*/ _jsx("path", {
            d: "M6 6l12 12M18 6 6 18"
        }),
        search: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "10.5",
                    cy: "10.5",
                    r: "6.5"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m16 16 4.5 4.5"
                })
            ]
        }),
        globe: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "8.5"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M3.5 12h17M12 3.5c2.2 2.3 3.3 5.1 3.3 8.5s-1.1 6.2-3.3 8.5c-2.2-2.3-3.3-5.1-3.3-8.5S9.8 5.8 12 3.5Z"
                })
            ]
        }),
        chevron: /*#__PURE__*/ _jsx("path", {
            d: "m8 10 4 4 4-4"
        }),
        check: /*#__PURE__*/ _jsx("path", {
            d: "m5 12 4 4L19 6"
        }),
        more: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "5",
                    cy: "12",
                    r: "1",
                    fill: "currentColor",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "12",
                    cy: "12",
                    r: "1",
                    fill: "currentColor",
                    stroke: "none"
                }),
                /*#__PURE__*/ _jsx("circle", {
                    cx: "19",
                    cy: "12",
                    r: "1",
                    fill: "currentColor",
                    stroke: "none"
                })
            ]
        }),
        left: /*#__PURE__*/ _jsx("path", {
            d: "m15 18-6-6 6-6"
        }),
        right: /*#__PURE__*/ _jsx("path", {
            d: "m9 6 6 6-6 6"
        }),
        copy: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "8",
                    y: "8",
                    width: "11",
                    height: "11",
                    rx: "2"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M16 8V5H5v11h3"
                })
            ]
        }),
        full: /*#__PURE__*/ _jsx(_Fragment, {
            children: /*#__PURE__*/ _jsx("path", {
                d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"
            })
        }),
        compare: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("rect", {
                    x: "4",
                    y: "4",
                    width: "16",
                    height: "16",
                    rx: "2"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 4v16"
                })
            ]
        }),
        zoomIn: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "11",
                    cy: "11",
                    r: "7"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m16 16 5 5M11 8v6M8 11h6"
                })
            ]
        }),
        zoomOut: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("circle", {
                    cx: "11",
                    cy: "11",
                    r: "7"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m16 16 5 5M8 11h6"
                })
            ]
        }),
        upscale: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m9 15 6-6M10 9h5v5"
                })
            ]
        }),
        flip: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M12 4v16M5 7h4M5 17h4M15 7h4M15 17h4"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "m8 4-3 3 3 3M16 14l3 3-3 3"
                })
            ]
        }),
        rotate: /*#__PURE__*/ _jsxs(_Fragment, {
            children: [
                /*#__PURE__*/ _jsx("path", {
                    d: "M5 8a7 7 0 1 1 1 8"
                }),
                /*#__PURE__*/ _jsx("path", {
                    d: "M5 4v4h4"
                })
            ]
        })
    };
    return /*#__PURE__*/ _jsx("svg", {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.8",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
        children: paths[name] || paths.more
    });
}
function Dropdown({ value, options, onChange, placeholder = '请选择', className = '' }) {
    return /*#__PURE__*/ _jsx(SelectMenu, {
        value,
        options: options.map((item)=>({
                value: item.value,
                label: item.label,
                description: item.meta,
                disabled: item.disabled
            })),
        onChange,
        ariaLabel: placeholder,
        className: `custom-dropdown ${className}`
    });
}
function ReferenceMentionMenu({ refs, open, onSelect, className = '' }) {
    if (!open || !refs.length) return null;
    return /*#__PURE__*/ _jsxs("div", {
        className: `reference-mention-menu ${className}`,
        role: "listbox",
        children: [
            /*#__PURE__*/ _jsx("div", {
                className: "reference-mention-title",
                children: "选择参考图 \xb7 输入 @编号"
            }),
            refs.map((ref, index)=>/*#__PURE__*/ _jsxs("button", {
                    type: "button",
                    onMouseDown: (event)=>event.preventDefault(),
                    onClick: ()=>onSelect(index),
                    children: [
                        /*#__PURE__*/ _jsxs("span", {
                            className: "reference-mention-thumb",
                            children: [
                                /*#__PURE__*/ _jsx("img", {
                                    src: ref.dataUrl,
                                    alt: ""
                                }),
                                /*#__PURE__*/ _jsxs("b", {
                                    children: [
                                        "@",
                                        index + 1
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("span", {
                            children: [
                                /*#__PURE__*/ _jsxs("strong", {
                                    children: [
                                        "参考图 ",
                                        index + 1
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("small", {
                                    children: ref.name
                                })
                            ]
                        })
                    ]
                }, ref.id))
        ]
    });
}
function EditorModal({ editor, editModelOptions, upscaleModelOptions, defaultUpscaleModel, defaultProviderId, defaultProviderName, defaultImageModelId, upscaleSourceSize, upscaleTargetPreview, onChange, onClose, onMaskEdit, onOpenProviders, onSubmit }) {
    const ratio = editorRatio(editor);
    const selectedUpscaleOption = editor.mode === 'upscale' ? editor.modelId === 'auto' ? defaultUpscaleModel : upscaleModelOptions.find((model)=>model.id === editor.modelId) || defaultUpscaleModel : null;
    const selectedUpscaleIsCloud = isCloudUpscaleModel(selectedUpscaleOption);
    const dimensions = editor.sizeMode === 'custom' ? {
        width: editor.customWidth,
        height: editor.customHeight
    } : presetDimensions(ratio === '自动' ? '1:1' : ratio, editor.sizeTier);
    const update = (patch)=>onChange({
            ...editor,
            ...patch
        });
    return /*#__PURE__*/ _jsx("div", {
        className: "editor-modal-backdrop",
        onClick: onClose,
        children: /*#__PURE__*/ _jsxs("form", {
            className: "editor-modal",
            onClick: (event)=>event.stopPropagation(),
            onSubmit: onSubmit,
            children: [
                /*#__PURE__*/ _jsxs("header", {
                    className: "editor-modal-head",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: editor.mode === 'upscale' ? '基于原图清晰化' : '基于原图继续'
                                }),
                                /*#__PURE__*/ _jsx("h2", {
                                    children: editor.mode === 'upscale' ? '图片超分' : '修改图片'
                                }),
                                /*#__PURE__*/ _jsx("p", {
                                    children: editor.mode === 'upscale' ? '提升原图清晰度，并控制目标尺寸与缩放算法。' : '描述修改内容，并像生图工作台一样调整输出参数。'
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("button", {
                            type: "button",
                            className: "icon-button",
                            onClick: onClose,
                            "aria-label": "关闭",
                            children: /*#__PURE__*/ _jsx(Icon, {
                                name: "close",
                                size: 16
                            })
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: "editor-modal-body",
                    children: [
                        /*#__PURE__*/ _jsxs("aside", {
                            className: "editor-source-panel",
                            children: [
                                /*#__PURE__*/ _jsx("div", {
                                    className: "editor-source-stage",
                                    children: /*#__PURE__*/ _jsx("img", {
                                        src: editor.item.url,
                                        alt: "原图"
                                    })
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "editor-source-copy",
                                    children: [
                                        /*#__PURE__*/ _jsx("small", {
                                            children: "原图"
                                        }),
                                        /*#__PURE__*/ _jsx("strong", {
                                            children: editor.item.prompt
                                        }),
                                        /*#__PURE__*/ _jsxs("span", {
                                            children: [
                                                editor.item.outputSize || '尺寸未记录',
                                                " \xb7 ",
                                                editor.item.aspectRatio || ratio
                                                             ]
                                                         })
                                                     ]
                                                 }),
                                                 /*#__PURE__*/ _jsxs("div", {
                                    className: "editor-size-summary",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "当前输出"
                                        }),
                                        /*#__PURE__*/ _jsx("strong", {
                                            children: editor.mode === 'upscale' && upscaleTargetPreview ? `${upscaleTargetPreview.width}×${upscaleTargetPreview.height}` : `${dimensions.width}×${dimensions.height}`
                                        }),
                                        /*#__PURE__*/ _jsx("small", {
                                            children: editor.mode === 'upscale' ? `${editor.scale}× 超分目标` : `${ratio} · ${editor.sizeMode === 'custom' ? '自定义尺寸' : editor.sizeTier.toUpperCase()}`
                                        })
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("section", {
                            className: "editor-settings-panel",
                            children: [
                                editor.mode === 'edit' && /*#__PURE__*/ _jsxs("div", {
                                    className: `editor-mask-control ${editor.mask ? 'active' : ''}`,
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            children: [
                                                /*#__PURE__*/ _jsx("strong", {
                                                    children: editor.mask ? '已设置局部蒙版' : '局部修改'
                                                }),
                                                /*#__PURE__*/ _jsx("small", {
                                                    children: editor.mask ? '红色区域会交给模型重新绘制' : '绘制蒙版后，只重新生成指定区域'
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "editor-mask-actions",
                                                             children: [
                                                             /*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    className: "ghost-button",
                                                    onClick: onMaskEdit,
                                                    children: editor.mask ? '重新绘制' : '绘制蒙版'
                                                }),
                                                editor.mask && /*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    className: "mask-clear",
                                                    onClick: ()=>update({
                                                            mask: null
                                                        }),
                                                    children: "移除"
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("label", {
                                    className: "field-block editor-prompt-field",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: editor.mode === 'upscale' ? '可选说明' : '你想怎么修改？'
                                        }),
                                        /*#__PURE__*/ _jsx("textarea", {
                                            autoFocus: editor.mode === 'edit',
                                            value: editor.prompt,
                                            onChange: (event)=>update({
                                                    prompt: event.target.value
                                                }),
                                            placeholder: editor.mode === 'upscale' ? 'SeedVR2 超分不会根据提示词修改画面…' : '例如：保留人物和构图，把背景改成夜晚的东京街头…'
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "editor-settings-grid",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "field-block",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: "图片模型"
                                                }),
                                                /*#__PURE__*/ _jsx(ModelPicker, {
                                                    models: editor.mode === 'upscale' ? upscaleModelOptions : editModelOptions,
                                                    value: editor.modelId,
                                                    capability: editor.mode === 'upscale' ? 'upscale' : 'edit',
                                                    defaultProviderId: defaultProviderId,
                                                    defaultProviderName: defaultProviderName,
                                                    defaultModelId: defaultImageModelId,
                                                    onChange: (value)=>{
                                                        if (editor.mode !== 'upscale') {
                                                            update({
                                                                modelId: value
                                                            });
                                                            return;
                                                        }
                                                        const nextModel = upscaleModelOptions.find((model)=>model.id === value);
                                                        const nextScales = nextModel?.scales || upscaleScales;
                                                        update({
                                                            modelId: value,
                                                            scale: nextScales.includes(editor.scale) ? editor.scale : nextScales.includes(2) ? 2 : nextScales[0],
                                                            upscaleOutputFormat: nextModel?.outputFormats?.includes(editor.upscaleOutputFormat) ? editor.upscaleOutputFormat : nextModel?.outputFormats?.[0] || editor.upscaleOutputFormat
                                                        });
                                                    }
                                                })
                                            ]
                                        }),
                                        editor.mode === 'edit' ? /*#__PURE__*/ _jsxs("div", {
                                            className: "field-block",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: "质量"
                                                }),
                                                /*#__PURE__*/ _jsx(Dropdown, {
                                                    value: editor.quality,
                                                    options: qualityOptions,
                                                    onChange: (value)=>update({
                                                            quality: value
                                                        })
                                                })
                                            ]
                                        }) : /*#__PURE__*/ _jsxs("div", {
                                            className: "field-block",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: "放大倍率"
                                                }),
                                                /*#__PURE__*/ _jsx(Dropdown, {
                                                    value: String(editor.scale),
                                                    options: (selectedUpscaleOption?.scales || upscaleScales).map((scale)=>({
                                                            value: String(scale),
                                                            label: `${scale}×`
                                                        })),
                                                    onChange: (value)=>update({
                                                            scale: Number(value),
                                                            targetSize: 'auto'
                                                        })
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                editor.mode === 'upscale' && selectedUpscaleOption && /*#__PURE__*/ _jsxs("div", {
                                    className: "upscale-model-note",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            children: [
                                                /*#__PURE__*/ _jsx("strong", {
                                                    children: selectedUpscaleOption.description || '提升分辨率和清晰度'
                                                }),
                                                /*#__PURE__*/ _jsx("small", {
                                                    children: selectedUpscaleOption.detail || selectedUpscaleOption.providerName
                                                })
                                            ]
                                        }),
                                        !selectedUpscaleOption.connected && /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: "ghost-button",
                                            onClick: onOpenProviders,
                                            children: "立即接入"
                                        }),
                                        selectedUpscaleOption.generative && /*#__PURE__*/ _jsx("small", {
                                            className: "warning",
                                            children: "生成式增强可能改变部分细节，不建议用于 Logo、文字、证件或精确商品细节。"
                                        })
                                    ]
                                }),
                                editor.mode === 'edit' ? /*#__PURE__*/ _jsxs("div", {
                                    className: "editor-parameter-card",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "editor-parameter-head",
                                            children: [
                                                /*#__PURE__*/ _jsx("strong", {
                                                    children: "尺寸与分辨率"
                                                }),
                                                /*#__PURE__*/ _jsxs("small", {
                                                    children: [
                                                        ratio,
                                                        " \xb7 ",
                                                        editor.sizeMode === 'custom' ? `${editor.customWidth}×${editor.customHeight}` : editor.sizeTier.toUpperCase()
                                                    ]
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "editor-parameter-block",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: "输出比例"
                                                }),
                                                /*#__PURE__*/ _jsx("div", {
                                                    className: "ratio-grid editor-ratios",
                                                    children: ratios.filter((item)=>item !== '自定义').map((item)=>/*#__PURE__*/ _jsx("button", {
                                                            type: "button",
                                                            className: editor.ratio === item ? 'active' : '',
                                                            onClick: ()=>update({
                                                                    ratio: item,
                                                                    sizeMode: 'system'
                                                                }),
                                                            children: item === '自动' && ratio !== '自动' ? `自动 · ${ratio}` : item
                                                        }, item))
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "editor-parameter-block",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: "分辨率"
                                                }),
                                                /*#__PURE__*/ _jsx("div", {
                                                    className: "resolution-tiers editor-resolution-tiers",
                                                    children: sizeTiers.map((tier)=>{
                                                        const preset = presetDimensions(ratio === '自动' ? '1:1' : ratio, tier.value);
                                                        return /*#__PURE__*/ _jsxs("button", {
                                                            type: "button",
                                                            className: editor.sizeMode === 'system' && editor.sizeTier === tier.value ? 'active' : '',
                                                            onClick: ()=>update({
                                                                    sizeMode: 'system',
                                                                    sizeTier: tier.value
                                                                }),
                                                            children: [
                                                                /*#__PURE__*/ _jsx("strong", {
                                                                    children: tier.label
                                                                }),
                                                                /*#__PURE__*/ _jsxs("small", {
                                                                    children: [
                                                                        preset.width,
                                                                        "\xd7",
                                                                        preset.height
                                                                    ]
                                                                })
                                                            ]
                                                        }, tier.value);
                                                    })
                                                }),
                                                /*#__PURE__*/ _jsxs("div", {
                                                    className: "custom-size-card editor-custom-size",
                                                    children: [
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            className: "custom-size-row",
                                                            children: [
                                                                /*#__PURE__*/ _jsxs("label", {
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: "宽度（px）"
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("input", {
                                                                            type: "number",
                                                                            min: "1",
                                                                            value: editor.customWidth,
                                                                            onChange: (event)=>update({
                                                                                    customWidth: Number(event.target.value) || 0,
                                                                                    sizeMode: 'custom'
                                                                                })
                                                                        })
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsx("b", {
                                                                    children: "\xd7"
                                                                }),
                                                                /*#__PURE__*/ _jsxs("label", {
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: "高度（px）"
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("input", {
                                                                            type: "number",
                                                                            min: "1",
                                                                            value: editor.customHeight,
                                                                            onChange: (event)=>update({
                                                                                    customHeight: Number(event.target.value) || 0,
                                                                                    sizeMode: 'custom'
                                                                                })
                                                                        })
                                                                    ]
                                                             })
                                                         ]
                                                     }),
                                                     /*#__PURE__*/ _jsx("small", {
                                                            children: "输入自定义尺寸后自动切换为自定义模式。"
                                                        })
                                                    ]
                                                })
                                            ]
                                        })
                                    ]
                                }) : /*#__PURE__*/ _jsxs("div", {
                                    className: "editor-upscale-details",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "upscale-target-readout editor-target-card",
                                            children: [
                                                /*#__PURE__*/ _jsxs("small", {
                                                    children: [
                                                        /*#__PURE__*/ _jsx("i", {
                                                            children: "原图"
                                                        }),
                                                        /*#__PURE__*/ _jsx("b", {
                                                            children: upscaleSourceSize ? `${upscaleSourceSize.width}×${upscaleSourceSize.height}` : '读取中…'
                                                        })
                                                    ]
                                                }),
                                                /*#__PURE__*/ _jsx("em", {
                                                    children: "→"
                                                }),
                                                /*#__PURE__*/ _jsxs("strong", {
                                                    children: [
                                                        /*#__PURE__*/ _jsx("i", {
                                                            children: "目标尺寸"
                                                        }),
                                                        /*#__PURE__*/ _jsx("b", {
                                                            children: upscaleTargetPreview ? `${upscaleTargetPreview.width}×${upscaleTargetPreview.height}` : '计算中…'
                                                        })
                                                    ]
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "editor-settings-grid",
                                            children: [
                                                !selectedUpscaleIsCloud && /*#__PURE__*/ _jsxs("label", {
                                                    className: "field-block",
                                                    children: [
                                                        /*#__PURE__*/ _jsx("span", {
                                                            children: "随机种子"
                                                        }),
                                                        /*#__PURE__*/ _jsx("input", {
                                                            className: "editor-seed-input",
                                                            type: "number",
                                                            min: "0",
                                                            max: "2147483647",
                                                            value: editor.seed,
                                                            onChange: (event)=>update({
                                                                    seed: Math.max(0, Number(event.target.value) || 0)
                                                                })
                                                        })
                                                    ]
                                                }),
                                                !selectedUpscaleIsCloud && /*#__PURE__*/ _jsxs("div", {
                                                    className: "field-block",
                                                    children: [
                                                        /*#__PURE__*/ _jsx("span", {
                                                            children: "缩放算法"
                                                        }),
                                                        /*#__PURE__*/ _jsx(Dropdown, {
                                                            value: editor.algorithm,
                                                            options: [
                                                                {
                                                                    value: 'lanczos',
                                                                    label: 'lanczos · 锐利'
                                                                },
                                                                {
                                                                    value: 'bicubic',
                                                                    label: 'bicubic · 平滑'
                                                                },
                                                                {
                                                                    value: 'nearest',
                                                                    label: 'nearest · 像素'
                                                                }
                                                            ],
                                                            onChange: (value)=>update({
                                                                    algorithm: value
                                                                })
                                                        })
                                                    ]
                                                }),
                                                selectedUpscaleOption?.outputFormats && /*#__PURE__*/ _jsxs("div", {
                                                    className: "field-block",
                                                    children: [
                                                        /*#__PURE__*/ _jsx("span", {
                                                            children: "输出格式"
                                                        }),
                                                        /*#__PURE__*/ _jsx(Dropdown, {
                                                            value: editor.upscaleOutputFormat,
                                                            options: cloudUpscaleFormatOptions.filter((option)=>selectedUpscaleOption.outputFormats.includes(option.value)),
                                                            onChange: (value)=>update({
                                                                upscaleOutputFormat: value
                                                            })
                                                        })
                                                    ]
                                                }),
                                                selectedUpscaleOption?.outputQuality && editor.upscaleOutputFormat === 'jpg' && /*#__PURE__*/ _jsxs("label", {
                                                    className: "field-block",
                                                    children: [
                                                        /*#__PURE__*/ _jsx("span", {
                                                            children: "JPG 质量"
                                                        }),
                                                        /*#__PURE__*/ _jsx("input", {
                                                            type: "number",
                                                            min: selectedUpscaleOption.outputQuality.min,
                                                            max: selectedUpscaleOption.outputQuality.max,
                                                            step: "1",
                                                            value: editor.upscaleOutputQuality,
                                                            onChange: (event)=>update({
                                                                upscaleOutputQuality: Math.max(selectedUpscaleOption.outputQuality.min, Math.min(selectedUpscaleOption.outputQuality.max, Number(event.target.value) || selectedUpscaleOption.outputQuality.default))
                                                            })
                                                        })
                                                    ]
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                editor.mode === 'edit' && /*#__PURE__*/ _jsxs("div", {
                                    className: "fidelity-row",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            children: [
                                                /*#__PURE__*/ _jsx("strong", {
                                                    children: "参考图一致性"
                                                }),
                                                /*#__PURE__*/ _jsx("small", {
                                                    children: "高：尽量保持主体；低：允许更大变化"
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "segmented mini",
                                            children: [
                                                /*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    className: editor.fidelity === 'high' ? 'active' : '',
                                                    onClick: ()=>update({
                                                            fidelity: 'high'
                                                        }),
                                                    children: "高"
                                                }),
                                                /*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    className: editor.fidelity === 'low' ? 'active' : '',
                                                    onClick: ()=>update({
                                                            fidelity: 'low'
                                                        }),
                                                    children: "低"
                                                })
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("footer", {
                    className: "editor-modal-footer",
                    children: [
                        /*#__PURE__*/ _jsx("small", {
                            children: "提交后任务会在后台处理，完成后自动进入创作记录。"
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "secondary-action",
                                    onClick: onClose,
                                    children: "取消"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    className: "primary-action",
                                    type: "submit",
                                    disabled: editor.mode === 'edit' && (!editor.prompt.trim() || editor.sizeMode === 'custom' && (editor.customWidth < 1 || editor.customHeight < 1)),
                                    children: editor.mode === 'upscale' ? `提交后台 ${editor.scale}× 超分` : '提交后台修改'
                                })
                            ]
                        })
                    ]
                })
            ]
        })
    });
}
function ReferenceStrip({ refs, onAdd, onRemove, onReorder, onClear, onPasteClick, onLocalUpscale, localUpscaleActive = false, label = '参考图' }) {
    const inputRef = useRef(null);
    const [dragIndex, setDragIndex] = useState(null);
    const [preview, setPreview] = useState(null);
    useBodyScrollLock(Boolean(preview));
    useEffect(()=>{
        if (!preview) return;
        const onKeyDown = (event)=>{
            if (event.key === 'Escape') setPreview(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return ()=>window.removeEventListener('keydown', onKeyDown);
    }, [
        preview
    ]);
    return /*#__PURE__*/ _jsxs("div", {
        className: `reference-block ${refs.length ? 'has-references' : ''}`,
        children: [
            /*#__PURE__*/ _jsxs("div", {
                className: "reference-head",
                children: [
                    /*#__PURE__*/ _jsxs("span", {
                        children: [
                            /*#__PURE__*/ _jsx(Icon, {
                                name: "image",
                                size: 14
                            }),
                            label,
                            refs.length > 0 && /*#__PURE__*/ _jsxs("b", {
                                children: [
                                    refs.length,
                                    " 张已添加"
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            onLocalUpscale && /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                className: `local-upscale-reference ${localUpscaleActive ? 'active' : ''}`,
                                disabled: !localUpscaleActive && (refs.length !== 1 || refs.some((ref)=>ref.pending)),
                                title: localUpscaleActive ? '返回普通生图模式' : refs.length !== 1 ? '本地超分需要恰好 1 张图片' : refs.some((ref)=>ref.pending) ? '参考图准备完成后才能超分' : '使用本地上传图片进行超分',
                                onClick: onLocalUpscale,
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "upscale",
                                        size: 12
                                    }),
                                    localUpscaleActive ? '返回生图' : '超分'
                                ]
                            }),
                            onPasteClick && /*#__PURE__*/ _jsx("button", {
                                type: "button",
                                className: "paste-reference",
                                onClick: onPasteClick,
                                children: "粘贴"
                            }),
                            refs.length > 0 && onClear && /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                className: "clear-references",
                                onClick: onClear,
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "close",
                                        size: 11
                                    }),
                                    "清空"
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("small", {
                                children: [
                                    refs.length,
                                    "/16 \xb7 支持 PNG/JPG/WEBP"
                                ]
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: `reference-strip ${refs.length ? 'has-items' : 'empty'}`,
                children: [
                    /*#__PURE__*/ _jsx("div", {
                        className: "reference-items",
                        children: refs.map((ref, index)=>/*#__PURE__*/ _jsxs("div", {
                                className: `reference-thumb ${ref.pending ? 'pending' : ''} ${dragIndex === index ? 'dragging' : ''}`,
                                title: `${ref.pending ? '正在准备 · ' : '点击预览 · '}${ref.name}`,
                                draggable: !ref.pending,
                                onClick: ()=>setPreview(ref),
                                onDragStart: (event)=>{
                                    if (ref.pending) return;
                                    setDragIndex(index);
                                    event.dataTransfer.effectAllowed = 'move';
                                    event.dataTransfer.setData('text/plain', ref.id);
                                },
                                onDragOver: (event)=>{
                                    event.preventDefault();
                                    if (!ref.pending) event.dataTransfer.dropEffect = 'move';
                                },
                                onDrop: (event)=>{
                                    event.preventDefault();
                                    if (!ref.pending && dragIndex !== null) onReorder(dragIndex, index);
                                    setDragIndex(null);
                                },
                                onDragEnd: ()=>setDragIndex(null),
                                children: [
                                    /*#__PURE__*/ _jsx("img", {
                                        draggable: false,
                                        src: ref.dataUrl,
                                        alt: ref.name
                                    }),
                                    ref.pending && /*#__PURE__*/ _jsxs("span", {
                                        className: "reference-pending-overlay",
                                        children: [
                                            /*#__PURE__*/ _jsx("i", {
                                                className: "mini-loader"
                                            }),
                                            "准备中"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "reference-index",
                                        children: index + 1
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "reference-remove",
                                        title: "移除参考图",
                                        "aria-label": `移除参考图 ${index + 1}`,
                                        draggable: false,
                                        onPointerDown: (event)=>event.stopPropagation(),
                                        onClick: (event)=>{
                                            event.stopPropagation();
                                            onRemove(ref.id);
                                        },
                                        children: /*#__PURE__*/ _jsx(Icon, {
                                            name: "close",
                                            size: 11
                                        })
                                    })
                                ]
                            }, ref.id))
                    }),
                    refs.length < 16 && /*#__PURE__*/ _jsxs("button", {
                        type: "button",
                        className: "add-reference",
                        onClick: ()=>inputRef.current?.click(),
                        children: [
                            /*#__PURE__*/ _jsx(Icon, {
                                name: "upload",
                                size: 18
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: refs.length ? '继续添加参考图' : '点击、拖入或粘贴参考图'
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsx("input", {
                hidden: true,
                ref: inputRef,
                type: "file",
                accept: "image/png,image/jpeg,image/webp",
                multiple: true,
                onChange: (e)=>{
                    if (e.target.files) onAdd(e.target.files);
                    e.currentTarget.value = '';
                }
            }),
            preview && typeof document !== 'undefined' && /*#__PURE__*/ createPortal(/*#__PURE__*/ _jsx("div", {
                className: "reference-preview-backdrop",
                onClick: ()=>setPreview(null),
                children: /*#__PURE__*/ _jsxs("div", {
                    className: "reference-preview surface",
                    onClick: (event)=>event.stopPropagation(),
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "reference-preview-head",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "参考图预览"
                                        }),
                                        /*#__PURE__*/ _jsx("h3", {
                                            children: preview.name
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "icon-button",
                                    onClick: ()=>setPreview(null),
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close"
                                    })
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("div", {
                            className: "reference-preview-stage",
                            children: /*#__PURE__*/ _jsx("img", {
                                src: preview.dataUrl,
                                alt: preview.name
                            })
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "reference-preview-footer",
                            children: [
                                /*#__PURE__*/ _jsx("small", {
                                    children: "完整比例显示，不裁剪"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "secondary-action compact",
                                    onClick: ()=>setPreview(null),
                                    children: "关闭"
                                })
                            ]
                        })
                    ]
                })
            }), document.body)
        ]
    });
}
function ImageCard({ item, selected, selectionMode, sourceOverride, comparisonSource: passedComparisonSource, previousItem, priority = false, onSelect, onPreview, onEdit, onUpscale, onReuse, onReference, onPushVideo, onCompare, onReversePrompt, onFavorite, onDownload, onDownloadShare, onDelete }) {
    const [menu, setMenu] = useState(false);
    const [imageState, setImageState] = useState('loading');
    const [retryToken, setRetryToken] = useState(0);
    const imageRef = useRef(null);
    useEffect(()=>{
        setImageState('loading');
        setRetryToken(0);
    }, [item.url]);
    useEffect(()=>{
        const image = imageRef.current;
        if (image?.complete) setImageState(image.naturalWidth > 0 ? 'loaded' : 'error');
    }, [item.url, retryToken]);
    const comparisonSource = passedComparisonSource || (previousItem ? {
        item: previousItem,
        kind: previousItem.id.startsWith('reference-') ? 'reference' : 'parent',
        label: previousItem.id.startsWith('reference-') ? '参考图' : '前一版'
    } : null);
    const references = galleryReferences(item);
    return /*#__PURE__*/ _jsxs("article", {
        className: `image-card ${selected ? 'selected' : ''}`,
        children: [
            /*#__PURE__*/ _jsxs("button", {
                className: "image-stage",
                type: "button",
                onClick: ()=>{
                    if (imageState === 'error') {
                        setImageState('loading');
                        setRetryToken((value)=>value + 1);
                        return;
                    }
                    if (selectionMode) onSelect?.();
                    else onPreview?.();
                },
                children: [
                    imageState === 'loading' && /*#__PURE__*/ _jsx("span", {
                        className: "image-loading-placeholder",
                        "aria-hidden": "true",
                        children: /*#__PURE__*/ _jsx("span", {
                            className: "image-loading-spinner"
                        })
                    }),
                    /*#__PURE__*/ _jsx("img", {
                        ref: imageRef,
                        src: retryToken ? `${item.url}${item.url.includes('?') ? '&' : '?'}retry=${retryToken}` : item.url,
                        alt: item.prompt || '生成图片',
                        loading: priority ? 'eager' : 'lazy',
                        decoding: 'async',
                        fetchPriority: priority ? 'high' : 'low',
                        onLoad: ()=>setImageState('loaded'),
                        onError: ()=>setImageState('error')
                    }),
                    imageState === 'error' && /*#__PURE__*/ _jsx("span", {
                        className: "image-load-error",
                        children: "图片加载失败 · 点击重试"
                    }),
                    selectionMode && /*#__PURE__*/ _jsx("span", {
                        className: `select-mark ${selected ? 'checked' : ''}`,
                        children: selected && /*#__PURE__*/ _jsx(Icon, {
                            name: "check",
                            size: 14
                        })
                    }),
                    typeof item.generationMs === 'number' && /*#__PURE__*/ _jsxs("span", {
                        className: "image-duration",
                        children: [
                            "⏱ ",
                            Math.max(0, item.generationMs / 1000).toFixed(1),
                            "s"
                        ]
                    }),
                    /*#__PURE__*/ _jsx("span", {
                        className: "image-source",
                        children: sourceLabel(sourceOverride || item.source)
                    })
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: "image-card-body",
                children: [
                    /*#__PURE__*/ _jsx("p", {
                        children: item.prompt || '未保存提示词'
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "image-meta",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                children: item.modelName || '图片模型'
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: item.outputSize || item.aspectRatio || '自动'
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: formatTime(item.createdAt)
                            })
                        ]
                    }),
                    references.length ? /*#__PURE__*/ _jsxs("div", {
                        className: "image-card-references",
                        title: references.map((reference, index) => `图 ${index + 1} · ${reference.name}`).join('\n'),
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "image-card-reference-label",
                                children: "参考图"
                            }),
                            references.slice(0, 4).map((reference, index) => /*#__PURE__*/ _jsxs("span", {
                                className: "image-card-reference-thumb",
                                children: [
                                    /*#__PURE__*/ _jsx("img", {
                                        src: reference.url,
                                        alt: `参考图 ${index + 1}`
                                    }),
                                    /*#__PURE__*/ _jsx("i", {
                                        children: index + 1
                                    })
                                ]
                            }, `${reference.url}-${index}`)),
                            references.length > 4 ? /*#__PURE__*/ _jsx("small", {
                                children: `+${references.length - 4}`
                            }) : null
                        ]
                    }) : null,
                    /*#__PURE__*/ _jsxs("div", {
                        className: "image-actions",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "image-actions-main",
                                children: [
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        onClick: onEdit,
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "edit",
                                                size: 15
                                            }),
                                            "修改"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "reuse-action",
                                        onClick: onReuse,
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "reuse",
                                                size: 15
                                            }),
                                            "复用参数"
                                        ]
                                    }),
                                    onPushVideo && /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "push-video-action",
                                        onClick: onPushVideo,
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "video",
                                                size: 15
                                            }),
                                            "生视频"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "reference-action",
                                        onClick: onReference,
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "image",
                                                size: 15
                                            }),
                                            "参考图"
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "image-actions-secondary",
                                children: [
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "download-action",
                                        onClick: onDownload,
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "download",
                                                size: 15
                                            }),
                                            "下载"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "more-wrap",
                                        tabIndex: -1,
                                        onBlur: (e)=>{
                                            if (!e.currentTarget.contains(e.relatedTarget)) setMenu(false);
                                        },
                                        children: [
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>setMenu((v)=>!v),
                                        title: "更多",
                                        children: /*#__PURE__*/ _jsx(Icon, {
                                            name: "more",
                                            size: 16
                                        })
                                    }),
                                    menu && /*#__PURE__*/ _jsxs("div", {
                                        className: "more-menu",
                                        children: [
                                            /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    void onReversePrompt();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "agent",
                                                        size: 15
                                                    }),
                                                    "反推提示词"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    onUpscale();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "upscale",
                                                        size: 15
                                                    }),
                                                    "高清放大"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    window.dispatchEvent(new CustomEvent('sanmao-angle', {
                                                        detail: item
                                                    }));
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "adjust",
                                                        size: 15
                                                    }),
                                                    "调整角度"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    window.dispatchEvent(new CustomEvent('sanmao-outpaint', {
                                                        detail: item
                                                    }));
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "full",
                                                        size: 15
                                                    }),
                                                    "图像编辑 / 扩图"
                                                ]
                                            }),
                                            comparisonSource && onCompare && /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    onCompare();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "compare",
                                                        size: 15
                                                    }),
                                                    comparisonSource.kind === 'reference' ? '与参考图对比' : '前后对比'
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                onClick: ()=>{
                                                    onReuse();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "reuse",
                                                        size: 15
                                                    }),
                                                    "用此参数再生成"
                                                ]
                                            }),
                                             /*#__PURE__*/ _jsxs("button", {
                                                 onClick: ()=>{
                                                     void onDownloadShare?.();
                                                     setMenu(false);
                                                 },
                                                 disabled: !references.length,
                                                 children: [
                                                     /*#__PURE__*/ _jsx(Icon, {
                                                         name: "download",
                                                         size: 15
                                                     }),
                                                     "下载分享版"
                                                 ]
                                             }),
                                             /*#__PURE__*/ _jsxs("button", {
                                                 onClick: ()=>{
                                                     onFavorite();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "star",
                                                        size: 15
                                                    }),
                                                    item.favorite ? '取消收藏' : '收藏'
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                className: "danger",
                                                onClick: ()=>{
                                                    onDelete();
                                                    setMenu(false);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "trash",
                                                        size: 15
                                                    }),
                                                    "删除"
                                                ]
                                            })
                                        ]
                                    })
                                        ]
                                    })
                                ]
                            })
                        ]
                    })
                ]
            })
        ]
    });
}
function CompareViewer({ item, source, parent, onClose }) {
    useBodyScrollLock(true);
    const [mode, setMode] = useState('slider');
    const [position, setPosition] = useState(50);
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({
        x: 0,
        y: 0
    });
    const [dragging, setDragging] = useState(false);
    const stageRef = useRef(null);
    const beforePaneRef = useRef(null);
    const currentPaneRef = useRef(null);
    const sliderDragRef = useRef(false);
    const panDragRef = useRef({
        active: false,
        x: 0,
        y: 0,
        panX: 0,
        panY: 0
    });
    const [imageSizes, setImageSizes] = useState({
        before: {
            width: 0,
            height: 0
        },
        current: {
            width: 0,
            height: 0
        }
    });
    const [viewportSizes, setViewportSizes] = useState({
        stage: {
            width: 0,
            height: 0
        },
        before: {
            width: 0,
            height: 0
        },
        current: {
            width: 0,
            height: 0
        }
    });
    useEffect(()=>{
        const stage = stageRef.current;
        if (!stage) return;
        const readSize = (element, fallback)=>element ? {
                width: element.clientWidth,
                height: element.clientHeight
            } : fallback;
        const measure = ()=>{
            const stageSize = {
                width: stage.clientWidth,
                height: stage.clientHeight
            };
            const next = {
                stage: stageSize,
                before: mode === 'slider' ? stageSize : readSize(beforePaneRef.current, stageSize),
                current: mode === 'slider' ? stageSize : readSize(currentPaneRef.current, stageSize)
            };
            setViewportSizes((current)=>current.stage.width === next.stage.width && current.stage.height === next.stage.height && current.before.width === next.before.width && current.before.height === next.before.height && current.current.width === next.current.width && current.current.height === next.current.height ? current : next);
        };
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(stage);
        if (beforePaneRef.current) observer?.observe(beforePaneRef.current);
        if (currentPaneRef.current) observer?.observe(currentPaneRef.current);
        window.addEventListener('resize', measure);
        return ()=>{
            observer?.disconnect();
            window.removeEventListener('resize', measure);
        };
    }, [
        mode
    ]);
    const beforeViewport = mode === 'slider' ? viewportSizes.stage : viewportSizes.before;
    const currentViewport = mode === 'slider' ? viewportSizes.stage : viewportSizes.current;
    const frameSizes = useMemo(()=>({
            before: compareContainSize(imageSizes.before, beforeViewport),
            current: compareContainSize(imageSizes.current, currentViewport)
        }), [
        beforeViewport,
        currentViewport,
        imageSizes
    ]);
    const panLimits = useMemo(()=>{
        const limits = [
            {
                frame: frameSizes.before,
                viewport: beforeViewport
            },
            {
                frame: frameSizes.current,
                viewport: currentViewport
            }
        ];
        return {
            x: Math.max(0, Math.min(...limits.map(({ frame, viewport })=>Math.max(0, (frame.width * zoom - viewport.width) / 2)))),
            y: Math.max(0, Math.min(...limits.map(({ frame, viewport })=>Math.max(0, (frame.height * zoom - viewport.height) / 2))))
        };
    }, [
        beforeViewport,
        currentViewport,
        frameSizes,
        zoom
    ]);
    function clampPan(next) {
        return {
            x: Math.min(panLimits.x, Math.max(-panLimits.x, next.x)),
            y: Math.min(panLimits.y, Math.max(-panLimits.y, next.y))
        };
    }
    useEffect(()=>{
        setPan((current)=>clampPan(current));
    }, [
        panLimits.x,
        panLimits.y
    ]);
    function handleImageLoad(side, event) {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (!naturalWidth || !naturalHeight) return;
        setImageSizes((current)=>current[side].width === naturalWidth && current[side].height === naturalHeight ? current : {
                ...current,
                [side]: {
                    width: naturalWidth,
                    height: naturalHeight
                }
            });
    }
    function updatePosition(clientX) {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        setPosition(Math.min(100, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width) * 100)));
    }
    function adjustZoom(next) {
        const value = Math.min(8, Math.max(1, Number(next.toFixed(2))));
        if (value === 1) {
            setZoom(1);
            setPan({
                x: 0,
                y: 0
            });
            return;
        }
        setZoom(value);
    }
    function resetView() {
        setZoom(1);
        setPan({
            x: 0,
            y: 0
        });
    }
    function handleWheel(event) {
        event.preventDefault();
        adjustZoom(zoom + (event.deltaY > 0 ? -0.1 : 0.1));
    }
    function handleStagePointerDown(event) {
        if (event.button !== 0) return;
        if (mode === 'slider' && event.target?.closest?.('.compare-divider')) return;
        event.preventDefault();
        if (zoom <= 1) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        panDragRef.current = {
            active: true,
            x: event.clientX,
            y: event.clientY,
            panX: pan.x,
            panY: pan.y
        };
        setDragging(true);
    }
    function handleStagePointerMove(event) {
        if (sliderDragRef.current) updatePosition(event.clientX);
        const drag = panDragRef.current;
        if (!drag.active) return;
        setPan(clampPan({
            x: drag.panX + event.clientX - drag.x,
            y: drag.panY + event.clientY - drag.y
        }));
    }
    function handleStagePointerUp(event) {
        panDragRef.current.active = false;
        sliderDragRef.current = false;
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
    function startSliderDrag(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        sliderDragRef.current = true;
        updatePosition(event.clientX);
    }
    function stopSliderDrag(event) {
        sliderDragRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
    function handleDividerKeyDown(event) {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        if (event.key === 'Home') return setPosition(0);
        if (event.key === 'End') return setPosition(100);
        setPosition((current)=>Math.min(100, Math.max(0, current + (event.key === 'ArrowRight' ? 5 : -5))));
    }
    function getFrameStyle(size) {
        return {
            width: Math.max(1, size.width),
            height: Math.max(1, size.height),
            left: `calc(50% + ${pan.x}px)`,
            top: `calc(50% + ${pan.y}px)`,
            transform: `translate(-50%, -50%) scale(${zoom})`
        };
    }
    const comparisonSource = source || {
        item: parent,
        kind: parent.id.startsWith('reference-') ? 'reference' : 'parent',
        label: parent.id.startsWith('reference-') ? '参考图' : '前一版'
    };
    const beforeLabel = comparisonSource.label;
    const heading = comparisonSource.kind === 'reference' ? '当前版本与参考图' : '当前版本与直接上一版';
    return /*#__PURE__*/ _jsx("div", {
        className: "compare-backdrop",
        onWheel: (event)=>event.preventDefault(),
        onClick: onClose,
        children: /*#__PURE__*/ _jsxs("section", {
            className: "compare-viewer",
            onClick: (event)=>event.stopPropagation(),
            children: [
                /*#__PURE__*/ _jsxs("header", {
                    className: "compare-top",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "compare-heading",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: "版本对比"
                                }),
                                /*#__PURE__*/ _jsx("strong", {
                                    children: heading
                                }),
                                /*#__PURE__*/ _jsxs("small", {
                                    children: [
                                        item.modelName || '图片模型',
                                        " \xb7 ",
                                        formatTime(item.createdAt)
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "compare-top-actions",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "compare-mode-switch",
                                    role: "group",
                                    "aria-label": "对比模式",
                                    children: [
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: mode === 'slider' ? 'active' : '',
                                            onClick: ()=>setMode('slider'),
                                            children: "滑块"
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: mode === 'side-by-side' ? 'active' : '',
                                            onClick: ()=>setMode('side-by-side'),
                                            children: "并排"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "zoom-controls",
                                    children: [
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            title: "缩小",
                                            onClick: ()=>adjustZoom(zoom - 0.1),
                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                name: "zoomOut",
                                                size: 16
                                            })
                                        }),
                                        /*#__PURE__*/ _jsxs("span", {
                                            className: "zoom-readout",
                                            children: [
                                                Math.round(zoom * 100),
                                                "%"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: "zoom-reset",
                                            onClick: resetView,
                                            children: "原比例"
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            title: "放大",
                                            onClick: ()=>adjustZoom(zoom + 0.1),
                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                name: "zoomIn",
                                                size: 16
                                            })
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "icon-button",
                                    onClick: onClose,
                                    "aria-label": "关闭版本对比",
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close"
                                    })
                                })
                            ]
                        })
                    ]
                }),
                /*#__PURE__*/ _jsx("div", {
                    className: "compare-stage-wrap",
                    children: /*#__PURE__*/ _jsxs("div", {
                        className: `compare-stage ${mode === 'slider' ? 'slider-mode' : 'side-by-side-mode'} ${zoom > 1 ? 'can-drag' : ''} ${dragging ? 'dragging' : ''}`,
                        ref: stageRef,
                        onWheel: handleWheel,
                        onPointerDown: handleStagePointerDown,
                        onPointerMove: handleStagePointerMove,
                        onPointerUp: handleStagePointerUp,
                        onPointerCancel: handleStagePointerUp,
                        onLostPointerCapture: handleStagePointerUp,
                        children: [
                            mode === 'slider' ? /*#__PURE__*/ _jsxs(_Fragment, {
                                children: [
                                    /*#__PURE__*/ _jsx("div", {
                                        className: "compare-image-layer",
                                        children: /*#__PURE__*/ _jsx("div", {
                                            className: "compare-image-frame",
                                            style: getFrameStyle(frameSizes.before),
                                            children: /*#__PURE__*/ _jsx("img", {
                                                draggable: false,
                                                onDragStart: (event)=>event.preventDefault(),
                                                src: comparisonSource.item.url,
                                                alt: beforeLabel,
                                                onLoad: (event)=>handleImageLoad('before', event)
                                            })
                                        })
                                    }),
                                    /*#__PURE__*/ _jsx("div", {
                                        className: "compare-image-layer compare-current-layer",
                                        style: {
                                            clipPath: `inset(0 0 0 ${position}%)`
                                        },
                                        children: /*#__PURE__*/ _jsx("div", {
                                            className: "compare-image-frame",
                                            style: getFrameStyle(frameSizes.current),
                                            children: /*#__PURE__*/ _jsx("img", {
                                                draggable: false,
                                                onDragStart: (event)=>event.preventDefault(),
                                                src: item.url,
                                                alt: "当前版本图片",
                                                onLoad: (event)=>handleImageLoad('current', event)
                                            })
                                        })
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "compare-divider",
                                        style: {
                                            left: `${position}%`
                                        },
                                        role: "slider",
                                        "aria-label": "调整前后版本分界线",
                                        "aria-valuemin": 0,
                                        "aria-valuemax": 100,
                                        "aria-valuenow": Math.round(position),
                                        onPointerDown: startSliderDrag,
                                        onPointerMove: (event)=>{
                                            if (sliderDragRef.current) updatePosition(event.clientX);
                                        },
                                        onPointerUp: stopSliderDrag,
                                        onPointerCancel: stopSliderDrag,
                                        onKeyDown: handleDividerKeyDown,
                                        children: /*#__PURE__*/ _jsx("span", {})
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "compare-label compare-label-before",
                                        children: beforeLabel
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "compare-label compare-label-after",
                                        children: "当前版"
                                    })
                                ]
                            }) : /*#__PURE__*/ _jsxs("div", {
                                className: "compare-side-grid",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "compare-side-pane",
                                        ref: beforePaneRef,
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "compare-label",
                                                children: beforeLabel
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "compare-image-frame",
                                                style: getFrameStyle(frameSizes.before),
                                                children: /*#__PURE__*/ _jsx("img", {
                                                    draggable: false,
                                                    onDragStart: (event)=>event.preventDefault(),
                                                    src: comparisonSource.item.url,
                                                    alt: beforeLabel,
                                                    onLoad: (event)=>handleImageLoad('before', event)
                                                })
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "compare-side-pane",
                                        ref: currentPaneRef,
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "compare-label",
                                                children: "当前版"
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "compare-image-frame",
                                                style: getFrameStyle(frameSizes.current),
                                                children: /*#__PURE__*/ _jsx("img", {
                                                    draggable: false,
                                                    onDragStart: (event)=>event.preventDefault(),
                                                    src: item.url,
                                                    alt: "当前版本图片",
                                                    onLoad: (event)=>handleImageLoad('current', event)
                                                })
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "wheel-tip",
                                children: [
                                    "滚轮缩放",
                                    zoom > 1 ? ' · 按住图片拖动查看' : ''
                                ]
                            })
                        ]
                    })
                }),
                /*#__PURE__*/ _jsxs("footer", {
                    className: "compare-info",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: beforeLabel
                                }),
                                /*#__PURE__*/ _jsx("strong", {
                                    children: comparisonSource.item.prompt || '未保存提示词'
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: "当前版"
                                }),
                                /*#__PURE__*/ _jsx("strong", {
                                    children: item.prompt || '未保存提示词'
                                })
                            ]
                        })
                    ]
                })
            ]
        })
    });
}
function centeredOutpaintLayout(sourceWidth, sourceHeight, canvasWidth, canvasHeight) {
    const width = Math.max(sourceWidth, Math.round(canvasWidth));
    const height = Math.max(sourceHeight, Math.round(canvasHeight));
    return {
        sourceWidth,
        sourceHeight,
        canvasWidth: width,
        canvasHeight: height,
        offsetX: Math.round((width - sourceWidth) / 2),
        offsetY: Math.round((height - sourceHeight) / 2)
    };
}
function defaultOutpaintLayout(sourceWidth, sourceHeight) {
    const padX = Math.ceil(Math.max(96, sourceWidth * 0.18) / 16) * 16;
    const padY = Math.ceil(Math.max(96, sourceHeight * 0.18) / 16) * 16;
    return centeredOutpaintLayout(sourceWidth, sourceHeight, sourceWidth + padX * 2, sourceHeight + padY * 2);
}
function outpaintRuleForModel(model) {
    const name = `${model?.rawId || ''} ${model?.displayName || ''} ${model?.providerName || ''}`.toLowerCase();
    if (/gpt[-_\s]*image[-_\s]*2/.test(name)) {
        return {
            family: 'gpt-image-2',
            label: 'GPT Image 2',
            hint: '长边 ≤ 3840，长短边 ≤ 3:1，像素量 655,360～8,294,400；提交时会自动做尺寸对齐。',
            maxEdge: 3840,
            minPixels: 655360,
            maxPixels: 8294400,
            maxRatio: 3
        };
    }
    if (/gemini.*3\.1.*flash.*image/.test(name) || /gemini.*flash.*image/.test(name)) {
        return {
            family: 'gemini-3.1-flash-image',
            label: 'Gemini 3.1 Flash Image',
            hint: '支持 512 / 1K / 2K / 4K 档位；当前工作台按长边 3840、约 16MP、最长宽高比 8:1 做提示。',
            maxEdge: 3840,
            maxPixels: 16777216,
            maxRatio: 8
        };
    }
    return {
        family: 'unknown',
        label: model?.displayName || '当前图片模型',
        hint: '未识别到公开尺寸限制；拖动时不额外拦截，若上游拒绝再按报错调整。'
    };
}
function validateOutpaintLayout(layout, rule) {
    const messages = [];
    const pixels = layout.canvasWidth * layout.canvasHeight;
    const longEdge = Math.max(layout.canvasWidth, layout.canvasHeight);
    const shortEdge = Math.max(1, Math.min(layout.canvasWidth, layout.canvasHeight));
    const ratio = longEdge / shortEdge;
    if (rule.maxEdge && longEdge > rule.maxEdge) messages.push(`${rule.label} 长边不能超过 ${rule.maxEdge}px`);
    if (rule.multiple && (layout.canvasWidth % rule.multiple !== 0 || layout.canvasHeight % rule.multiple !== 0)) messages.push(`${rule.label} 宽高需要是 ${rule.multiple}px 的倍数`);
    if (rule.maxRatio && ratio > rule.maxRatio) messages.push(`${rule.label} 长短边比例不能超过 ${rule.maxRatio}:1`);
    if (rule.maxPixels && pixels > rule.maxPixels) messages.push(`${rule.label} 画布像素量超过上限`);
    if (rule.minPixels && pixels < rule.minPixels) messages.push(`${rule.label} 画布像素量低于下限`);
    return {
        valid: messages.length === 0,
        messages,
        pixels,
        ratio
    };
}
function fitOutpaintLayoutToRule(layout, rule) {
    let width = layout.canvasWidth;
    let height = layout.canvasHeight;
    const multiple = rule.multiple || 1;
    const snapUp = (value)=>Math.ceil(Math.max(1, value) / multiple) * multiple;
    const snapDown = (value)=>Math.max(multiple, Math.floor(Math.max(1, value) / multiple) * multiple);
    width = Math.max(layout.sourceWidth, snapUp(width));
    height = Math.max(layout.sourceHeight, snapUp(height));
    if (rule.maxRatio && Math.max(width, height) / Math.max(1, Math.min(width, height)) > rule.maxRatio) {
        if (width > height) height = Math.max(height, snapUp(width / rule.maxRatio));
        else width = Math.max(width, snapUp(height / rule.maxRatio));
    }
    if (rule.maxEdge && Math.max(width, height) > rule.maxEdge) {
        const scale = rule.maxEdge / Math.max(width, height);
        width = Math.max(layout.sourceWidth, snapDown(width * scale));
        height = Math.max(layout.sourceHeight, snapDown(height * scale));
    }
    if (rule.maxPixels && width * height > rule.maxPixels) {
        const scale = Math.sqrt(rule.maxPixels / (width * height));
        width = Math.max(layout.sourceWidth, snapDown(width * scale));
        height = Math.max(layout.sourceHeight, snapDown(height * scale));
    }
    if (rule.minPixels && width * height < rule.minPixels) {
        const scale = Math.sqrt(rule.minPixels / Math.max(1, width * height));
        width = Math.max(layout.sourceWidth, snapUp(width * scale));
        height = Math.max(layout.sourceHeight, snapUp(height * scale));
    }
    return centeredOutpaintLayout(layout.sourceWidth, layout.sourceHeight, width, height);
}
function OutpaintEditor({ item, model, onClose, onApply, onApplyLocal, onNotify }) {
    const stageRef = useRef(null);
    const [tool, setTool] = useState('outpaint');
    const [layout, setLayout] = useState(null);
    const [stageSize, setStageSize] = useState({
        width: 900,
        height: 520
    });
    const [drag, setDrag] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [applying, setApplying] = useState(false);
    const [localMode, setLocalMode] = useState('crop');
    const [localRatio, setLocalRatio] = useState('原图');
    const [localBackground, setLocalBackground] = useState('transparent');
    const [localFlipX, setLocalFlipX] = useState(false);
    const [localRotation, setLocalRotation] = useState(0);
    const [localApplying, setLocalApplying] = useState(false);
    const [cropRect, setCropRect] = useState(null);
    const [cropDrag, setCropDrag] = useState(null);
    const rule = outpaintRuleForModel(model);
    const validation = layout ? validateOutpaintLayout(layout, rule) : null;
    const fitPadding = 192;
    const fitScale = layout ? Math.max(0.04, Math.min(1, Math.max(80, Math.max(280, stageSize.width) - fitPadding) / layout.canvasWidth, Math.max(80, Math.max(220, stageSize.height) - fitPadding) / layout.canvasHeight)) : 1;
    const displayScale = layout ? Math.max(0.03, Math.min(8, fitScale * zoom)) : 1;
    const pads = layout ? {
        left: layout.offsetX,
        right: layout.canvasWidth - layout.offsetX - layout.sourceWidth,
        top: layout.offsetY,
        bottom: layout.canvasHeight - layout.offsetY - layout.sourceHeight
    } : {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0
    };
    const localRatios = [
        '原图',
        '自由',
        '1:1',
        '4:5',
        '16:9',
        '9:16',
        '4:3',
        '3:4'
    ];
    const localBackgrounds = [
        {
            value: 'transparent',
            label: '透明'
        },
        {
            value: 'white',
            label: '白色'
        },
        {
            value: 'black',
            label: '黑色'
        },
        {
            value: 'blur',
            label: '模糊'
        }
    ];
    const [ratioWidth, ratioHeight] = localRatio === '原图' ? [
        layout?.sourceWidth || 1,
        layout?.sourceHeight || 1
    ] : localRatio.split(':').map(Number);
    const localPreviewStyle = {
        aspectRatio: `${ratioWidth} / ${ratioHeight}`,
        ...localBackground === 'blur' ? {
            backgroundImage: `url("${item.url}")`
        } : {}
    };
    const localPreviewScale = Math.max(0.05, Math.min((Math.max(280, stageSize.width) - 144) / ratioWidth, (Math.max(220, stageSize.height) - 112) / ratioHeight));
    const localPreviewWidth = Math.max(1, Math.round(ratioWidth * localPreviewScale));
    const localPreviewHeight = Math.max(1, Math.round(ratioHeight * localPreviewScale));
    const fullCropRect = {
        x: 0,
        y: 0,
        width: layout?.sourceWidth || 1,
        height: layout?.sourceHeight || 1
    };
    const activeCropRect = cropRect || fullCropRect;
    const cropDisplayScale = Math.max(0.05, Math.min((Math.max(280, stageSize.width) - 144) / fullCropRect.width, (Math.max(220, stageSize.height) - 112) / fullCropRect.height));
    const cropDisplayWidth = Math.max(1, Math.round(fullCropRect.width * cropDisplayScale));
    const cropDisplayHeight = Math.max(1, Math.round(fullCropRect.height * cropDisplayScale));
    const cropFrameStyle = {
        left: activeCropRect.x * cropDisplayScale,
        top: activeCropRect.y * cropDisplayScale,
        width: activeCropRect.width * cropDisplayScale,
        height: activeCropRect.height * cropDisplayScale
    };
    const localImageStyle = {
        transform: `scaleX(${localFlipX ? -1 : 1}) rotate(${localRotation}deg)`,
        objectFit: localMode === 'canvas' ? 'contain' : 'cover'
    };
    const localOperations = [
        localRatio !== '原图' ? `${localMode === 'canvas' ? '补边' : '裁剪'} ${localRatio}` : '',
        localMode === 'canvas' && localRatio !== '原图' && localBackground !== 'transparent' ? `背景 ${localBackgrounds.find((option)=>option.value === localBackground)?.label}` : '',
        localFlipX ? '水平镜像' : '',
        localRotation ? `旋转 ${localRotation}°` : ''
    ].filter(Boolean);
    useEffect(()=>{
        const target = stageRef.current;
        if (!target) return;
        let frame = 0;
        const update = ()=>{
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(()=>{
                const rect = target.getBoundingClientRect();
                const next = {
                    width: Math.round(rect.width) || 900,
                    height: Math.round(rect.height) || 520
                };
                setStageSize((old)=>Math.abs(old.width - next.width) < 2 && Math.abs(old.height - next.height) < 2 ? old : next);
            });
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(target);
        return ()=>{
            cancelAnimationFrame(frame);
            observer.disconnect();
        };
    }, []);
    useEffect(()=>{
        if (!drag) return;
        const move = (event)=>{
            const dx = Math.round((event.clientX - drag.startX) / drag.scale);
            const dy = Math.round((event.clientY - drag.startY) / drag.scale);
            const start = drag.layout;
            let left = start.offsetX;
            let right = start.canvasWidth - start.offsetX - start.sourceWidth;
            let top = start.offsetY;
            let bottom = start.canvasHeight - start.offsetY - start.sourceHeight;
            if (drag.handle.includes('left')) left -= dx;
            if (drag.handle.includes('right')) right += dx;
            if (drag.handle.includes('top')) top -= dy;
            if (drag.handle.includes('bottom')) bottom += dy;
            setLayoutFromPads(start, left, right, top, bottom);
        };
        const end = ()=>setDrag(null);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, {
            once: true
        });
        window.addEventListener('pointercancel', end, {
            once: true
        });
        return ()=>{
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, [
        drag
    ]);
    useEffect(()=>{
        if (!cropDrag) return;
        const move = (event)=>{
            const dx = (event.clientX - cropDrag.startX) / cropDrag.scale;
            const dy = (event.clientY - cropDrag.startY) / cropDrag.scale;
            const start = cropDrag.rect;
            const sourceWidth = fullCropRect.width;
            const sourceHeight = fullCropRect.height;
            const minimum = Math.min(64, Math.max(16, Math.min(sourceWidth, sourceHeight) / 2));
            if (cropDrag.handle === 'move') {
                setCropRect({
                    ...start,
                    x: clampNumber(start.x + dx, 0, sourceWidth - start.width),
                    y: clampNumber(start.y + dy, 0, sourceHeight - start.height)
                });
                return;
            }
            const isFree = localRatio === '自由' || localRatio === '原图';
            if (isFree) {
                const right = start.x + start.width;
                const bottom = start.y + start.height;
                let left = start.x;
                let top = start.y;
                let nextRight = right;
                let nextBottom = bottom;
                if (cropDrag.handle.includes('left')) left = clampNumber(start.x + dx, 0, right - minimum);
                if (cropDrag.handle.includes('right')) nextRight = clampNumber(right + dx, left + minimum, sourceWidth);
                if (cropDrag.handle.includes('top')) top = clampNumber(start.y + dy, 0, bottom - minimum);
                if (cropDrag.handle.includes('bottom')) nextBottom = clampNumber(bottom + dy, top + minimum, sourceHeight);
                setCropRect({
                    x: left,
                    y: top,
                    width: nextRight - left,
                    height: nextBottom - top
                });
                if (localRatio === '原图') setLocalRatio('自由');
                return;
            }
            const [rawRatioWidth, rawRatioHeight] = localRatio.split(':').map(Number);
            const targetRatio = rawRatioWidth / rawRatioHeight;
            const horizontal = cropDrag.handle.includes('left') || cropDrag.handle.includes('right');
            const vertical = cropDrag.handle.includes('top') || cropDrag.handle.includes('bottom');
            const anchorX = cropDrag.handle.includes('left') ? start.x + start.width : start.x;
            const anchorY = cropDrag.handle.includes('top') ? start.y + start.height : start.y;
            const maxWidth = cropDrag.handle.includes('left') ? anchorX : sourceWidth - anchorX;
            const maxHeight = cropDrag.handle.includes('top') ? anchorY : sourceHeight - anchorY;
            const widthFromX = cropDrag.handle.includes('left') ? start.width - dx : start.width + dx;
            const heightFromY = cropDrag.handle.includes('top') ? start.height - dy : start.height + dy;
            let nextWidth = horizontal && vertical ? Math.max(widthFromX, heightFromY * targetRatio) : horizontal ? widthFromX : heightFromY * targetRatio;
            nextWidth = clampNumber(nextWidth, minimum, Math.min(maxWidth, maxHeight * targetRatio));
            const nextHeight = nextWidth / targetRatio;
            const nextX = cropDrag.handle.includes('left') ? anchorX - nextWidth : anchorX;
            const nextY = cropDrag.handle.includes('top') ? anchorY - nextHeight : anchorY;
            setCropRect({
                x: nextX,
                y: nextY,
                width: nextWidth,
                height: nextHeight
            });
        };
        const end = ()=>setCropDrag(null);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end, {
            once: true
        });
        window.addEventListener('pointercancel', end, {
            once: true
        });
        return ()=>{
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);
        };
    }, [
        cropDrag,
        fullCropRect.height,
        fullCropRect.width,
        localRatio
    ]);
    function setLayoutFromPads(base, rawLeft, rawRight, rawTop, rawBottom) {
        const left = Math.round(Math.max(0, rawLeft));
        const right = Math.round(Math.max(0, rawRight));
        const top = Math.round(Math.max(0, rawTop));
        const bottom = Math.round(Math.max(0, rawBottom));
        setLayout({
            ...base,
            canvasWidth: base.sourceWidth + left + right,
            canvasHeight: base.sourceHeight + top + bottom,
            offsetX: left,
            offsetY: top
        });
    }
    function adjustPadding(side, amount) {
        if (!layout) return;
        setLayoutFromPads(layout, pads.left + (side === 'left' ? amount : 0), pads.right + (side === 'right' ? amount : 0), pads.top + (side === 'top' ? amount : 0), pads.bottom + (side === 'bottom' ? amount : 0));
    }
    function applyRatio(target) {
        if (!layout) return;
        const [rawWidth, rawHeight] = target.split(':').map(Number);
        const targetRatio = rawWidth / rawHeight;
        let canvasWidth = layout.sourceWidth;
        let canvasHeight = layout.sourceHeight;
        if (layout.sourceWidth / layout.sourceHeight > targetRatio) canvasHeight = Math.max(layout.sourceHeight, Math.round(layout.sourceWidth / targetRatio));
        else canvasWidth = Math.max(layout.sourceWidth, Math.round(layout.sourceHeight * targetRatio));
        setLayout(centeredOutpaintLayout(layout.sourceWidth, layout.sourceHeight, canvasWidth, canvasHeight));
    }
    function resetLayout() {
        if (!layout) return;
        setLayout(defaultOutpaintLayout(layout.sourceWidth, layout.sourceHeight));
        setZoom(1);
    }
    function resetLocal() {
        setLocalMode('crop');
        setLocalRatio('原图');
        setLocalBackground('transparent');
        setLocalFlipX(false);
        setLocalRotation(0);
        setCropRect(fullCropRect);
    }
    function selectLocalMode(nextMode) {
        setLocalMode(nextMode);
        if (nextMode === 'canvas' && localRatio === '自由') {
            setLocalRatio('原图');
            setCropRect(fullCropRect);
        }
    }
    function selectLocalRatio(nextRatio) {
        setLocalRatio(nextRatio);
        if (nextRatio === '自由') return;
        if (!layout) return;
        setCropRect(cropSourceRect(layout.sourceWidth, layout.sourceHeight, nextRatio));
    }
    function fitToRule() {
        if (!layout || rule.family === 'unknown') return;
        setLayout(fitOutpaintLayoutToRule(layout, rule));
        setZoom(1);
    }
    function handleStageWheel(event) {
        if (!layout || tool !== 'outpaint') return;
        event.preventDefault();
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        setZoom((value)=>Math.max(0.18, Math.min(5, Math.round(value * factor * 100) / 100)));
    }
    async function applyOutpaint() {
        if (!layout) return;
        const currentValidation = validateOutpaintLayout(layout, rule);
        if (!currentValidation.valid) {
            onNotify(currentValidation.messages[0] || '当前画布尺寸不适合所选模型');
            return;
        }
        setApplying(true);
        try {
            const rendered = await renderOutpaintWhiteCanvas(item.url, layout);
            await onApply(rendered);
        } catch (error) {
            onNotify(error instanceof Error ? error.message : '扩图处理失败');
        } finally{
            setApplying(false);
        }
    }
    async function applyLocal() {
        setLocalApplying(true);
        try {
            const rendered = await renderLocalImage(item.url, localMode, localRatio, localBackground, localFlipX, localRotation, localMode === 'crop' ? activeCropRect : undefined);
            await onApplyLocal(rendered, localOperations);
        } catch (error) {
            onNotify(error instanceof Error ? error.message : '本地图片处理失败');
        } finally{
            setLocalApplying(false);
        }
    }
    const rotateLocal = (step)=>setLocalRotation((value)=>(value + step + 360) % 360);
    const startCropResize = (handle, event)=>{
        if (!layout) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setCropDrag({
            handle,
            startX: event.clientX,
            startY: event.clientY,
            scale: cropDisplayScale,
            rect: activeCropRect
        });
    };
    const startResize = (handle, event)=>{
        if (!layout) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrag({
            handle,
            startX: event.clientX,
            startY: event.clientY,
            scale: displayScale,
            layout
        });
    };
    return /*#__PURE__*/ _jsx("div", {
        className: "outpaint-editor-backdrop",
        onClick: onClose,
        children: /*#__PURE__*/ _jsxs("section", {
            className: "outpaint-editor surface",
            onClick: (event)=>event.stopPropagation(),
            children: [
                /*#__PURE__*/ _jsxs("header", {
                    className: "outpaint-editor-head",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: "图像编辑"
                                }),
                                /*#__PURE__*/ _jsx("h2", {
                                    children: tool === 'outpaint' ? 'AI 扩图 / 填充' : '裁剪 / 补边 / 变换'
                                }),
                                /*#__PURE__*/ _jsx("small", {
                                    children: tool === 'outpaint' ? '原图默认居中，拖动边框扩出白边；滚轮只缩放视图，不改变输出尺寸。' : '裁剪和补边均在本机完成，不消耗模型额度；原图会保留。'
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("button", {
                            type: "button",
                            className: "icon-button",
                            onClick: onClose,
                            children: /*#__PURE__*/ _jsx(Icon, {
                                name: "close"
                            })
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: "outpaint-toolbar",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "image-editor-tabs",
                            children: [
                                /*#__PURE__*/ _jsxs("button", {
                                    type: "button",
                                    className: tool === 'outpaint' ? 'active' : '',
                                    onClick: ()=>setTool('outpaint'),
                                    children: [
                                        /*#__PURE__*/ _jsx(Icon, {
                                            name: "full",
                                            size: 15
                                        }),
                                        "AI 扩图"
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("button", {
                                    type: "button",
                                    className: tool === 'local' ? 'active' : '',
                                    onClick: ()=>setTool('local'),
                                    children: [
                                        /*#__PURE__*/ _jsx(Icon, {
                                            name: "adjust",
                                            size: 15
                                        }),
                                        "裁剪与变换"
                                    ]
                                })
                            ]
                        }),
                        tool === 'outpaint' ? /*#__PURE__*/ _jsxs("div", {
                            className: "outpaint-tool-options",
                            children: [
                                [
                                    '1:1',
                                    '4:5',
                                    '16:9',
                                    '9:16',
                                    '21:9',
                                    '4:1',
                                    '1:4',
                                    '8:1',
                                    '1:8'
                                ].map((itemRatio)=>/*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>applyRatio(itemRatio),
                                        children: itemRatio
                                    }, itemRatio)),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: resetLayout,
                                    children: "还原居中"
                                }),
                                rule.family !== 'unknown' && /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: fitToRule,
                                    children: "适配模型限制"
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                    className: `outpaint-model-hint ${validation && !validation.valid ? 'invalid' : ''}`,
                                    children: validation && !validation.valid ? validation.messages[0] : `${rule.label} · ${rule.hint}`
                                })
                            ]
                        }) : /*#__PURE__*/ _jsxs("div", {
                            className: "local-tool-options",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "local-tool-group",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "方式"
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: localMode === 'crop' ? 'active' : '',
                                            onClick: ()=>selectLocalMode('crop'),
                                            children: "裁剪"
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: localMode === 'canvas' ? 'active' : '',
                                            onClick: ()=>selectLocalMode('canvas'),
                                            children: "补边"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "local-tool-group",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "比例"
                                        }),
                                        localRatios.filter((ratio)=>localMode === 'crop' || ratio !== '自由').map((ratio)=>/*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: localRatio === ratio ? 'active' : '',
                                                onClick: ()=>selectLocalRatio(ratio),
                                                children: ratio
                                            }, ratio))
                                    ]
                                }),
                                localMode === 'canvas' && /*#__PURE__*/ _jsxs("div", {
                                    className: "local-tool-group",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "背景"
                                        }),
                                        localBackgrounds.map((option)=>/*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: localBackground === option.value ? `active bg-${option.value}` : `bg-${option.value}`,
                                                onClick: ()=>setLocalBackground(option.value),
                                                children: option.label
                                            }, option.value))
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "local-tool-group local-transform-tools",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "变换"
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            type: "button",
                                            className: localFlipX ? 'active' : '',
                                            onClick: ()=>setLocalFlipX((value)=>!value),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "flip",
                                                    size: 14
                                                }),
                                                "镜像"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            type: "button",
                                            onClick: ()=>rotateLocal(-90),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "rotate",
                                                    size: 14
                                                }),
                                                "左转"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            type: "button",
                                            onClick: ()=>rotateLocal(90),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "rotate",
                                                    size: 14
                                                }),
                                                "右转"
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: `outpaint-stage ${tool === 'local' ? 'local-editor-stage' : ''}`,
                    ref: stageRef,
                    onWheel: handleStageWheel,
                    children: [
                        /*#__PURE__*/ _jsx("img", {
                            className: "outpaint-loader",
                            src: item.url,
                            alt: "",
                            onLoad: (event)=>{
                                if (layout) return;
                                const width = event.currentTarget.naturalWidth;
                                const height = event.currentTarget.naturalHeight;
                                setLayout(defaultOutpaintLayout(width, height));
                                setCropRect({
                                    x: 0,
                                    y: 0,
                                    width,
                                    height
                                });
                            }
                        }),
                        tool === 'outpaint' ? layout ? /*#__PURE__*/ _jsx("div", {
                            className: "outpaint-stage-inner",
                            children: /*#__PURE__*/ _jsxs("div", {
                                className: `outpaint-workspace ${validation && !validation.valid ? 'invalid' : ''}`,
                                style: {
                                    width: layout.canvasWidth * displayScale,
                                    height: layout.canvasHeight * displayScale
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("img", {
                                        className: "outpaint-image",
                                        src: item.url,
                                        alt: item.prompt,
                                        style: {
                                            left: layout.offsetX * displayScale,
                                            top: layout.offsetY * displayScale,
                                            width: layout.sourceWidth * displayScale,
                                            height: layout.sourceHeight * displayScale
                                        }
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: `outpaint-size-badge ${validation && !validation.valid ? 'invalid' : ''}`,
                                        children: [
                                            layout.canvasWidth,
                                            " \xd7 ",
                                            layout.canvasHeight
                                        ]
                                    }),
                                    [
                                        'left',
                                        'right',
                                        'top',
                                        'bottom',
                                        'top-left',
                                        'top-right',
                                        'bottom-left',
                                        'bottom-right'
                                    ].map((handle)=>/*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            "aria-label": `拖动 ${handle}`,
                                            className: `outpaint-handle ${handle}`,
                                            onPointerDown: (event)=>startResize(handle, event)
                                        }, handle))
                                ]
                            })
                        }) : /*#__PURE__*/ _jsxs("div", {
                            className: "outpaint-loading",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    className: "mini-loader"
                                }),
                                "读取图片尺寸…"
                            ]
                        }) : localMode === 'crop' && layout ? /*#__PURE__*/ _jsx("div", {
                            className: "crop-editor-stage-inner",
                            children: /*#__PURE__*/ _jsxs("div", {
                                className: "crop-source-frame",
                                style: {
                                    width: cropDisplayWidth,
                                    height: cropDisplayHeight
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("img", {
                                        className: "crop-source-image",
                                        src: item.url,
                                        alt: item.prompt || '图片预览'
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "crop-dim-mask",
                                        style: {
                                            left: 0,
                                            top: 0,
                                            width: '100%',
                                            height: activeCropRect.y * cropDisplayScale
                                        }
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "crop-dim-mask",
                                        style: {
                                            left: 0,
                                            top: (activeCropRect.y + activeCropRect.height) * cropDisplayScale,
                                            width: '100%',
                                            height: Math.max(0, (fullCropRect.height - activeCropRect.y - activeCropRect.height) * cropDisplayScale)
                                        }
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "crop-dim-mask",
                                        style: {
                                            left: 0,
                                            top: activeCropRect.y * cropDisplayScale,
                                            width: activeCropRect.x * cropDisplayScale,
                                            height: activeCropRect.height * cropDisplayScale
                                        }
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "crop-dim-mask",
                                        style: {
                                            left: (activeCropRect.x + activeCropRect.width) * cropDisplayScale,
                                            top: activeCropRect.y * cropDisplayScale,
                                            width: Math.max(0, (fullCropRect.width - activeCropRect.x - activeCropRect.width) * cropDisplayScale),
                                            height: activeCropRect.height * cropDisplayScale
                                        }
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "crop-selection",
                                        style: cropFrameStyle,
                                        children: [
                                            /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "crop-move-zone",
                                                "aria-label": "拖动裁剪框",
                                                onPointerDown: (event)=>startCropResize('move', event)
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "crop-grid"
                                            }),
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "crop-size-badge",
                                                children: [
                                                    Math.round(activeCropRect.width),
                                                    " \xd7 ",
                                                    Math.round(activeCropRect.height)
                                                ]
                                            }),
                                            [
                                                'left',
                                                'right',
                                                'top',
                                                'bottom',
                                                'top-left',
                                                'top-right',
                                                'bottom-left',
                                                'bottom-right'
                                            ].map((handle)=>/*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    "aria-label": `拖动裁剪框 ${handle}`,
                                                    className: `outpaint-handle crop-handle ${handle}`,
                                                    onPointerDown: (event)=>startCropResize(handle, event)
                                                }, handle))
                                        ]
                                    })
                                ]
                            })
                        }) : /*#__PURE__*/ _jsx("div", {
                            className: "local-editor-stage-inner",
                            children: /*#__PURE__*/ _jsxs("div", {
                                className: `local-editor-workspace ${localMode} bg-${localBackground}`,
                                style: {
                                    ...localPreviewStyle,
                                    width: localPreviewWidth,
                                    height: localPreviewHeight
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("img", {
                                        src: item.url,
                                        alt: item.prompt || '图片预览',
                                        style: localImageStyle
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        className: "local-editor-size-badge",
                                        children: [
                                            "完整保留 \xb7 ",
                                            localRatio
                                        ]
                                    })
                                ]
                            })
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: "outpaint-controls",
                    children: [
                        tool === 'outpaint' ? /*#__PURE__*/ _jsxs("div", {
                            className: "outpaint-pad-controls",
                            children: [
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>layout && setLayoutFromPads(layout, pads.left + 160, pads.right + 160, pads.top + 160, pads.bottom + 160),
                                    children: "四周 +160"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>adjustPadding('left', 160),
                                    children: "左 +160"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>adjustPadding('right', 160),
                                    children: "右 +160"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>adjustPadding('top', 160),
                                    children: "上 +160"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>adjustPadding('bottom', 160),
                                    children: "下 +160"
                                })
                            ]
                        }) : /*#__PURE__*/ _jsxs("div", {
                            className: "local-editor-summary",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: localOperations.length ? localOperations.join('、') : '保持原图尺寸和方向'
                                }),
                                /*#__PURE__*/ _jsx("small", {
                                    children: "本机处理 \xb7 不调用模型"
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "outpaint-actions",
                            children: [
                                tool === 'outpaint' ? /*#__PURE__*/ _jsxs(_Fragment, {
                                    children: [
                                        /*#__PURE__*/ _jsxs("span", {
                                            className: "outpaint-zoom-readout",
                                            children: [
                                                "视图 ",
                                                Math.round(zoom * 100),
                                                "%"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: "secondary-action compact",
                                            onClick: ()=>setZoom(1),
                                            children: "适合窗口"
                                        })
                                    ]
                                }) : /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "secondary-action compact",
                                    onClick: resetLocal,
                                    children: "重置变换"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "secondary-action",
                                    onClick: onClose,
                                    children: "取消"
                                }),
                                tool === 'outpaint' ? /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "primary-action compact",
                                    disabled: !layout || applying || Boolean(validation && !validation.valid),
                                    onClick: ()=>void applyOutpaint(),
                                    children: applying ? /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mini-loader"
                                            }),
                                            "处理中…"
                                        ]
                                    }) : '发布到生图'
                                }) : /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "primary-action compact",
                                    disabled: localApplying,
                                    onClick: ()=>void applyLocal(),
                                    children: localApplying ? /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "mini-loader"
                                            }),
                                            "处理中…"
                                        ]
                                    }) : '保存处理版本'
                                })
                            ]
                        })
                    ]
                })
            ]
        })
    });
}
function ChatFileList({ files, onDownload, onRemove }) {
    if (!files.length) return null;
    return /*#__PURE__*/ _jsx("div", {
        className: "message-files",
        children: files.map((file)=>/*#__PURE__*/ _jsxs("article", {
                className: "message-file",
                children: [
                    /*#__PURE__*/ _jsx("div", {
                        className: "message-file-icon",
                        children: /*#__PURE__*/ _jsx(Icon, {
                            name: "folder",
                            size: 18
                        })
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "message-file-info",
                        children: [
                            /*#__PURE__*/ _jsx("strong", {
                                title: file.name,
                                children: file.name
                            }),
                            /*#__PURE__*/ _jsxs("small", {
                                children: [
                                    file.mimeType.replace(/;.*$/, ''),
                                    " \xb7 ",
                                    formatFileSize(file.size)
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("button", {
                        type: "button",
                        className: "message-file-download",
                        onClick: ()=>onDownload(file),
                        children: [
                            /*#__PURE__*/ _jsx(Icon, {
                                name: "download",
                                size: 14
                            }),
                            "下载"
                        ]
                    }),
                    onRemove && /*#__PURE__*/ _jsx("button", {
                        type: "button",
                        className: "message-file-remove",
                        onClick: ()=>onRemove(file),
                        title: "移除文件",
                        children: /*#__PURE__*/ _jsx(Icon, {
                            name: "close",
                            size: 13
                        })
                    })
                ]
            }, file.id))
    });
}
function renderInlineMarkdown(text) {
    const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*|_[^_]+_)/g;
    const nodes = [];
    let cursor = 0;
    let match;
    while(match = pattern.exec(text)){
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        const token = match[0];
        if (token.startsWith('**') || token.startsWith('__')) nodes.push(/*#__PURE__*/ _jsx("strong", {
            children: token.slice(2, -2)
        }, `${match.index}-b`));
        else if (token.startsWith('`')) nodes.push(/*#__PURE__*/ _jsx("code", {
            className: "inline-code",
            children: token.slice(1, -1)
        }, `${match.index}-c`));
        else if (token.startsWith('[')) {
            const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
            if (link) nodes.push(/*#__PURE__*/ _jsx("a", {
                href: link[2],
                target: "_blank",
                rel: "noreferrer",
                children: link[1]
            }, `${match.index}-a`));
            else nodes.push(token);
        } else nodes.push(/*#__PURE__*/ _jsx("em", {
            children: token.slice(1, -1)
        }, `${match.index}-i`));
        cursor = match.index + token.length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
}
function MarkdownBlocks({ lines }) {
    const blocks = [];
    let paragraph = [];
    const flushParagraph = ()=>{
        if (!paragraph.length) return;
        blocks.push(/*#__PURE__*/ _jsx("p", {
            children: paragraph.map((line, index)=>/*#__PURE__*/ _jsxs(Fragment, {
                    children: [
                        index > 0 && /*#__PURE__*/ _jsx("br", {}),
                        renderInlineMarkdown(line)
                    ]
                }, index))
        }, `p-${blocks.length}`));
        paragraph = [];
    };
    let index = 0;
    while(index < lines.length){
        const line = lines[index];
        if (!line.trim()) {
            flushParagraph();
            index += 1;
            continue;
        }
        const heading = line.match(/^(#{1,6})\s+(.+)$/);
        if (heading) {
            flushParagraph();
            const Tag = `h${heading[1].length}`;
            blocks.push(/*#__PURE__*/ _jsx(Tag, {
                children: renderInlineMarkdown(heading[2])
            }, `h-${index}`));
            index += 1;
            continue;
        }
        const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
        const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
        if (unordered || ordered) {
            flushParagraph();
            const listItems = [];
            const orderedList = Boolean(ordered);
            while(index < lines.length){
                const item = lines[index].match(orderedList ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/);
                if (!item) break;
                listItems.push(item[1]);
                index += 1;
            }
            const ListTag = orderedList ? 'ol' : 'ul';
            blocks.push(/*#__PURE__*/ _jsx(ListTag, {
                children: listItems.map((item, itemIndex)=>/*#__PURE__*/ _jsx("li", {
                        children: renderInlineMarkdown(item)
                    }, itemIndex))
            }, `list-${index}`));
            continue;
        }
        if (/^>\s?/.test(line)) {
            flushParagraph();
            const quote = [];
            while(index < lines.length && /^>\s?/.test(lines[index])){
                quote.push(lines[index].replace(/^>\s?/, ''));
                index += 1;
            }
            blocks.push(/*#__PURE__*/ _jsx("blockquote", {
                children: quote.map((item, quoteIndex)=>/*#__PURE__*/ _jsxs(Fragment, {
                        children: [
                            quoteIndex > 0 && /*#__PURE__*/ _jsx("br", {}),
                            renderInlineMarkdown(item)
                        ]
                    }, quoteIndex))
            }, `quote-${index}`));
            continue;
        }
        paragraph.push(line);
        index += 1;
    }
    flushParagraph();
    return /*#__PURE__*/ _jsx(_Fragment, {
        children: blocks
    });
}
function renderCodeLine(text, language) {
    if (![
        'js',
        'jsx',
        'ts',
        'tsx',
        'javascript',
        'typescript',
        'json',
        'css',
        'html',
        'htm',
        'xml',
        'svg'
    ].includes(language)) return [
        text
    ];
    const pattern = /(\/\/.*$|\/\*[\s\S]*?\*\/|<!--.*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|if|else|for|while|return|function|true|false|null|undefined|new|class|this|import|from|export|async|await|try|catch|throw)\b|\b\d+(?:\.\d+)?\b)/g;
    const nodes = [];
    let cursor = 0;
    let match;
    while(match = pattern.exec(text)){
        if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
        const token = match[0];
        const className = /^(\/\/|\/\*|<!--)/.test(token) ? 'code-token-comment' : /^("|'|`)/.test(token) ? 'code-token-string' : /^\d/.test(token) ? 'code-token-number' : 'code-token-keyword';
        nodes.push(/*#__PURE__*/ _jsx("span", {
            className: className,
            children: token
        }, `${match.index}-${className}`));
        cursor = match.index + token.length;
    }
    if (cursor < text.length) nodes.push(text.slice(cursor));
    return nodes;
}
function AssistantCodeBlock({ language, code, onNotify }) {
    const [expanded, setExpanded] = useState(false);
    const normalizedLanguage = language.trim().toLowerCase() || 'text';
    const lines = code.replace(/\n$/, '').split('\n');
    async function copyCode() {
        try {
            await navigator.clipboard.writeText(code);
            onNotify('代码已复制');
        } catch  {
            onNotify('复制失败');
        }
    }
    function runCode() {
        if (![
            'html',
            'htm',
            'svg',
            'xml'
        ].includes(normalizedLanguage)) return onNotify('当前语言仅支持复制，不能在浏览器中直接运行');
        const type = normalizedLanguage === 'svg' ? 'image/svg+xml' : 'text/html';
        const url = URL.createObjectURL(new Blob([
            code
        ], {
            type
        }));
        const tab = window.open(url, '_blank', 'noopener,noreferrer');
        if (!tab) onNotify('浏览器拦截了预览窗口，请允许弹窗');
        window.setTimeout(()=>URL.revokeObjectURL(url), 20000);
    }
    return /*#__PURE__*/ _jsxs("div", {
        className: `assistant-code-block ${expanded ? 'expanded' : ''}`,
        children: [
            /*#__PURE__*/ _jsxs("div", {
                className: "assistant-code-toolbar",
                children: [
                    /*#__PURE__*/ _jsx("span", {
                        className: "assistant-code-language",
                        children: normalizedLanguage
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        className: "assistant-code-actions",
                        children: [
                            [
                                'html',
                                'htm',
                                'svg',
                                'xml'
                            ].includes(normalizedLanguage) && /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                onClick: runCode,
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "code-run-symbol",
                                        children: "▶"
                                    }),
                                    "运行"
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                onClick: ()=>void copyCode(),
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "copy",
                                        size: 13
                                    }),
                                    "复制"
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                onClick: ()=>setExpanded((value)=>!value),
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: expanded ? 'close' : 'full',
                                        size: 13
                                    }),
                                    expanded ? '关闭' : '全屏'
                                ]
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsx("pre", {
                children: /*#__PURE__*/ _jsx("code", {
                    children: lines.map((line, index)=>/*#__PURE__*/ _jsxs("span", {
                            className: "assistant-code-line",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    className: "assistant-code-number",
                                    children: index + 1
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                    className: "assistant-code-text",
                                    children: renderCodeLine(line || ' ', normalizedLanguage)
                                })
                            ]
                        }, index))
                })
            })
        ]
    });
}
function AgentImageLoadingCard({ activity }) {
    const stage = activity?.stage || 'image_planning';
    const message = activity?.message || (stage === 'image_generating' ? '正在生成图片…' : '正在构思画面…');
    const details = [activity?.model, activity?.mode === 'edit' ? '编辑模式' : activity?.mode === 'generate' ? '生成模式' : '', activity?.count ? `${activity.count} 张` : ''].filter(Boolean).join(' · ');
    return /*#__PURE__*/ _jsxs("div", {
        className: "agent-image-loading-card",
        role: "status",
        "aria-live": "polite",
        children: [
            /*#__PURE__*/ _jsx("div", { className: "agent-image-loading-scan" }),
            /*#__PURE__*/ _jsxs("div", {
                className: "agent-image-loading-copy",
                children: [
                    /*#__PURE__*/ _jsx("strong", { children: message }),
                    /*#__PURE__*/ _jsx("small", { children: details || (stage === 'caption' ? '马上展示图片与创作建议' : '正在处理本次创作请求') })
                ]
            }),
            /*#__PURE__*/ _jsxs("div", {
                className: "agent-image-loading-skeleton",
                "aria-hidden": "true",
                children: [/*#__PURE__*/ _jsx("i", {}), /*#__PURE__*/ _jsx("i", {}), /*#__PURE__*/ _jsx("i", {})]
            })
        ]
    });
}
function AgentDirectionPicker({ directions, disabled, onSelect }) {
    return /*#__PURE__*/ _jsx("div", {
        className: "agent-direction-options",
        children: directions.map((direction, index)=>/*#__PURE__*/ _jsxs("button", {
                type: "button",
                className: "agent-direction-option",
                disabled: disabled,
                title: direction,
                "aria-label": `第${index + 1}项：${direction}`,
                onClick: ()=>onSelect?.(direction),
                children: [
                    /*#__PURE__*/ _jsx("span", {
                        className: "agent-direction-option-number",
                        children: index + 1
                    }),
                    /*#__PURE__*/ _jsx("span", {
                        className: "agent-direction-option-copy",
                        children: direction
                    }),
                    /*#__PURE__*/ _jsx("span", {
                        className: "agent-direction-option-arrow",
                        "aria-hidden": "true",
                        children: "›"
                    })
                ]
            }, `${index}-${direction}`))
    });
}
function AssistantMarkdown({ content, onNotify, directionPicker }) {
    const shouldCollapse = content.length > 2400 || content.split(/\n/).length > 36;
    const [expanded, setExpanded] = useState(false);
    const lines = content.replace(/\r/g, '').split('\n');
    const blocks = [];
    let normalLines = [];
    let codeLanguage = null;
    let codeLines = [];
    const flushNormal = ()=>{
        if (normalLines.length) {
            blocks.push(/*#__PURE__*/ _jsx(MarkdownBlocks, {
                lines: normalLines
            }, `markdown-${blocks.length}`));
            normalLines = [];
        }
    };
    let directionInserted = false;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1){
        const line = lines[lineIndex];
        const isDirectionHeading = directionPicker && (directionPicker.kind === 'chat' ? isChatDirectionHeading(line) : /(?:下一版|下个版本|后续).{0,24}(?:可尝试|尝试方向|调整方向|方向)/i.test(line));
        if (isDirectionHeading && !directionInserted) {
            flushNormal();
            blocks.push(/*#__PURE__*/ _jsxs("section", {
                className: "agent-direction-section",
                children: [
                    /*#__PURE__*/ _jsx("h3", {
                        children: line.replace(/^\s*#{1,6}\s*/, '').trim()
                    }),
                    /*#__PURE__*/ _jsx(AgentDirectionPicker, {
                        directions: directionPicker.directions,
                        disabled: directionPicker.disabled,
                        onSelect: directionPicker.onSelect
                    })
                ]
            }, `directions-${blocks.length}`));
            directionInserted = true;
            lineIndex += 1;
            while (lineIndex < lines.length) {
                if (!lines[lineIndex].trim() || /^\s*(?:(?:[-*+•])\s*|\d+[.)、]\s*)/.test(lines[lineIndex])) {
                    lineIndex += 1;
                    continue;
                }
                break;
            }
            lineIndex -= 1;
            continue;
        }
        const fence = line.match(/^\s*```\s*([^\s]*)\s*$/);
        if (fence) {
            if (codeLanguage === null) {
                flushNormal();
                codeLanguage = fence[1] || 'text';
                codeLines = [];
            } else {
                blocks.push(/*#__PURE__*/ _jsx(AssistantCodeBlock, {
                    language: codeLanguage,
                    code: codeLines.join('\n'),
                    onNotify: onNotify
                }, `code-${blocks.length}`));
                codeLanguage = null;
                codeLines = [];
            }
        } else if (codeLanguage !== null) codeLines.push(line);
        else normalLines.push(line);
    }
    if (codeLanguage !== null) blocks.push(/*#__PURE__*/ _jsx(AssistantCodeBlock, {
        language: codeLanguage,
        code: codeLines.join('\n'),
        onNotify: onNotify
    }, `code-${blocks.length}`));
    flushNormal();
    if (directionPicker?.kind === 'chat' && !directionInserted) {
        blocks.push(/*#__PURE__*/ _jsxs("section", {
            className: "agent-direction-section chat-direction-section",
            children: [
                /*#__PURE__*/ _jsx("h3", { children: "你还可以继续" }),
                /*#__PURE__*/ _jsx(AgentDirectionPicker, {
                    directions: directionPicker.directions,
                    disabled: directionPicker.disabled,
                    onSelect: directionPicker.onSelect
                })
            ]
        }, `directions-${blocks.length}`));
    }
    return /*#__PURE__*/ _jsxs("div", {
        className: `assistant-markdown ${shouldCollapse && !expanded ? 'is-collapsed' : ''}`,
        children: [
            /*#__PURE__*/ _jsx("div", {
                className: "assistant-markdown-content",
                children: blocks
            }),
            shouldCollapse && /*#__PURE__*/ _jsx("button", {
                type: "button",
                className: "assistant-markdown-toggle",
                "aria-expanded": expanded,
                onClick: ()=>setExpanded((value)=>!value),
                children: expanded ? '收起长内容' : '展开完整内容'
            })
        ]
    });
}
export default function Page() {
    const [section, setSectionState] = useState('agent');
    const sectionRef = useRef('agent');
    const lastNonAngleSectionRef = useRef('agent');
    function setSection(next) {
        const previousSection = sectionRef.current;
        sectionRef.current = next;
        if (next !== 'angle') {
            lastNonAngleSectionRef.current = next;
            try {
                localStorage.setItem(LAST_SECTION_STORAGE_KEY, next);
            } catch  {}
        }
        setSectionState(next);
        if (next === 'agent' && previousSection !== 'agent') requestChatScrollAfterCommit();
    }
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [supportOpen, setSupportOpen] = useState(false);
    const [supportTab, setSupportTab] = useState('community');
    useEffect(()=>{
        if (!supportOpen) return;
        const closeOnEscape = (event)=>{
            if (event.key === 'Escape') setSupportOpen(false);
        };
        window.addEventListener('keydown', closeOnEscape);
        return ()=>window.removeEventListener('keydown', closeOnEscape);
    }, [
        supportOpen
    ]);
    const [theme, setTheme] = useState('light');
    const [successSoundEnabled, setSuccessSoundEnabled] = useState(false);
    const successAudioRef = useRef(null);
    const [state, setState] = useState(emptyState);
    const [loadingState, setLoadingState] = useState(true);
    const [toast, setToast] = useState('');
    const toastTimerRef = useRef(null);
    const [confirmState, setConfirmState] = useState(null);
    // Keep the feedback global so every send/generate entry point gets the same
    // lightweight celebration without touching its existing submit handler.
    useEffect(()=>{
        const motionQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : { matches: false };
        const celebrationLabels = /^(发送|提交后台|按当前机位生成|开始生成|开始\d+×超分|基于参考图生成|测试并连接|测试并保存|发布到生图|保存处理版本|应用蒙版|重试|重新生成|用此参数再生成)/;
        const isCelebrationButton = (button)=>{
            if (button.matches('.send-button, .angle-submit .primary-action, .generate-submit-sticky .primary-action')) return true;
            const label = button.textContent?.replace(/\s+/g, '').trim() || '';
            return celebrationLabels.test(label);
        };
        const handleClick = (event)=>{
            const target = event.target;
            if (!(target instanceof Element)) return;
            const button = target.closest('button');
            if (!(button instanceof HTMLButtonElement) || button.disabled || !isCelebrationButton(button)) return;
            const reducedMotion = motionQuery.matches && document.documentElement.dataset.motion !== 'on';
            button.classList.remove('celebration-button-active');
            void button.offsetWidth;
            button.classList.add('celebration-button-active');
            window.setTimeout(()=>button.classList.remove('celebration-button-active'), 560);
            const rect = button.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const burst = document.createElement('span');
            burst.className = `celebration-burst ${reducedMotion ? 'celebration-burst-reduced' : ''}`;
            burst.setAttribute('aria-hidden', 'true');
            burst.style.left = `${rect.left + rect.width / 2}px`;
            burst.style.top = `${rect.top + rect.height / 2}px`;
            const colors = [
                '#ffcc66',
                '#ff8f70',
                '#78d8ff',
                '#9ee6b8',
                '#d8a5ff',
                '#ffffff'
            ];
            const particleCount = reducedMotion ? 0 : 24;
            for(let index = 0; index < particleCount; index += 1){
                const particle = document.createElement('i');
                const angle = Math.PI * 2 * index / particleCount + (Math.random() - 0.5) * 0.32;
                const distance = 28 + Math.random() * 46;
                particle.className = `celebration-particle ${index % 4 === 0 ? 'spark' : index % 4 === 1 ? 'dot' : 'ribbon'}`;
                particle.style.setProperty('--burst-x', `${Math.cos(angle) * distance}px`);
                particle.style.setProperty('--burst-y', `${Math.sin(angle) * distance - 6}px`);
                particle.style.setProperty('--burst-rotate', `${Math.round(angle * 180 / Math.PI + 90)}deg`);
                particle.style.setProperty('--burst-delay', `${Math.round(Math.random() * 100)}ms`);
                particle.style.setProperty('--burst-color', colors[index % colors.length]);
                particle.style.setProperty('--burst-scale', `${0.72 + Math.random() * 0.72}`);
                burst.appendChild(particle);
            }
            document.body.appendChild(burst);
            window.setTimeout(()=>burst.remove(), reducedMotion ? 720 : 1100);
        };
        document.addEventListener('click', handleClick, true);
        return ()=>document.removeEventListener('click', handleClick, true);
    }, []);
    const [adminRequired, setAdminRequired] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');
    const [adminBusy, setAdminBusy] = useState(false);
    const [providerEditor, setProviderEditor] = useState(false);
    const [providerEditId, setProviderEditId] = useState(null);
    const [providerBusy, setProviderBusy] = useState(false);
    const [providerTestBusy, setProviderTestBusy] = useState(false);
    const [providerTestResult, setProviderTestResult] = useState('');
    const [jimengLogin, setJimengLogin] = useState({ status: 'idle', installed: false, version: '', verificationUri: '', userCode: '', deviceCode: '', message: '', error: '', account: null, accountCheckedAt: '', accountError: '' });
    const [syncingId, setSyncingId] = useState(null);
    const [providerForm, setProviderForm] = useState(emptyProviderForm);
    const selectedProviderPreset = getProviderPreset(providerForm.platform);
    const [modelSearch, setModelSearch] = useState('');
    const [modelProviderFilter, setModelProviderFilter] = useState('all');
    const [modelKindFilter, setModelKindFilter] = useState('all');
    const [expandedModelProviders, setExpandedModelProviders] = useState(new Set());
    const modelKindBusyRef = useRef(new Set());
    const [modelKindBusy, setModelKindBusy] = useState(new Set());
    const modelGroupsInitializedRef = useRef(false);
    const [modelFavorites, setModelFavorites] = useState([]);
    const [messages, setMessages] = useState([]);
    const [chatSessions, setChatSessions] = useState([]);
    const [renamingChatId, setRenamingChatId] = useState(null);
    const [renamingChatTitle, setRenamingChatTitle] = useState('');
    const [activeChatId, setActiveChatId] = useState(null);
    const [agentInput, setAgentInput] = useState('');
    const [promptOptimizing, setPromptOptimizing] = useState(false);
    const [busyChatIds, setBusyChatIds] = useState([]);
    const [agentRefs, setAgentRefs] = useState([]);
    const [messageReferencePreview, setMessageReferencePreview] = useState(null);
    const [sharePreview, setSharePreview] = useState(null);
    const [shareBusy, setShareBusy] = useState(false);
    const [shareSelectionMode, setShareSelectionMode] = useState(false);
    const [selectedShareGroups, setSelectedShareGroups] = useState(new Set());
    const [agentFiles, setAgentFiles] = useState([]);
    const [agentModelId, setAgentModelId] = useState('auto');
    const [agentWebMode, setAgentWebMode] = useState('auto');
    const [agentWebModeMenuOpen, setAgentWebModeMenuOpen] = useState(false);
    const [webSearchApiProvider, setWebSearchApiProvider] = useState('baidu-qianfan');
    const [webSearchProviderMenuOpen, setWebSearchProviderMenuOpen] = useState(false);
    const [webSearchApiKey, setWebSearchApiKey] = useState('');
    const [webSearchApiBusy, setWebSearchApiBusy] = useState(false);
    const [webSearchApiResult, setWebSearchApiResult] = useState('');
    const webSearchProviderMenuRef = useRef(null);
    const webSearchAnySearchSelected = webSearchApiProvider === 'anysearch';
    const webSearchAnySearchKeyConfigured = Boolean(state.settings.webSearchAnySearchConfigured);
    const selectedWebSearchConfigured = webSearchAnySearchSelected
        ? true
        : Boolean(state.settings.webSearchQianfanConfigured);
    useEffect(()=>{
        if (!webSearchProviderMenuOpen) return;
        const closeMenu = (event)=>{
            if (!webSearchProviderMenuRef.current?.contains(event.target)) setWebSearchProviderMenuOpen(false);
        };
        document.addEventListener('pointerdown', closeMenu);
        return ()=>document.removeEventListener('pointerdown', closeMenu);
    }, [webSearchProviderMenuOpen]);
    const [chatHistorySearch, setChatHistorySearch] = useState('');
    const [agentFollowUp, setAgentFollowUp] = useState(null);
    const [agentMessageSelectionMode, setAgentMessageSelectionMode] = useState(false);
    const [selectedAgentMessages, setSelectedAgentMessages] = useState(new Set());
    const [chatSelectionMode, setChatSelectionMode] = useState(false);
    const [selectedChatSessions, setSelectedChatSessions] = useState(new Set());
    const [selectionPush, setSelectionPush] = useState(null);
    const [videoPromptPrefill, setVideoPromptPrefill] = useState(null);
    const [videoReferenceQueue, setVideoReferenceQueue] = useState([]);
    const [videoMediaPrefill, setVideoMediaPrefill] = useState(null);
    const [videoMediaPrefillToken, setVideoMediaPrefillToken] = useState(0);
    const [chatNearBottom, setChatNearBottom] = useState(true);
    const chatEndRef = useRef(null);
    const agentComposerRef = useRef(null);
    const agentInputRef = useRef(null);
    const chatAutoFollowRef = useRef(false);
    const chatScrollAfterCommitRef = useRef(false);
    const chatScrollFramesRef = useRef({ first: 0, second: 0 });
    const [conversationNavOpen, setConversationNavOpen] = useState(false);
    const conversationNavigatorRef = useRef(null);
    const conversationNavCloseTimerRef = useRef(0);
    const conversationNavCloseAfterClickRef = useRef(false);
    const activeChatIdRef = useRef(null);
    const busyChatIdsRef = useRef(new Set());
    const pendingChatMessagesRef = useRef(new Map());
    const agentRequestsRef = useRef(new Map());
    const chatSaveQueuesRef = useRef(new Map());
    const [agentMentionOpen, setAgentMentionOpen] = useState(false);
    useEffect(()=>{
        if (!messageReferencePreview) return;
        const onKeyDown = (event)=>{
            if (event.key === 'Escape') setMessageReferencePreview(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return ()=>window.removeEventListener('keydown', onKeyDown);
    }, [
        messageReferencePreview
    ]);
    useEffect(()=>{
        if (!sharePreview) return;
        const onKeyDown = (event)=>{
            if (event.key === 'Escape') setSharePreview(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return ()=>{
            window.removeEventListener('keydown', onKeyDown);
            URL.revokeObjectURL(sharePreview.url);
        };
    }, [sharePreview]);
    const [generatePrompt, setGeneratePrompt] = useState('');
    const [generatePromptOptimizing, setGeneratePromptOptimizing] = useState(false);
    const [generatePromptBeforeOptimization, setGeneratePromptBeforeOptimization] = useState(null);
    const generatePromptRef = useRef(null);
    const [generateMentionOpen, setGenerateMentionOpen] = useState(false);
    const [generateModelId, setGenerateModelId] = useState('auto');
    const [generateUpscaleModelId, setGenerateUpscaleModelId] = useState('auto');
    const [generateWorkflow, setGenerateWorkflow] = useState('generate');
    const [ratio, setRatio] = useState('1:1');
    const [customRatioWidth, setCustomRatioWidth] = useState(16);
    const [customRatioHeight, setCustomRatioHeight] = useState(9);
    const [sizeMode, setSizeMode] = useState('system');
    const [sizeDrawer, setSizeDrawer] = useState(null);
    const [sizeMenuStyle, setSizeMenuStyle] = useState({});
    const sizeTabsRef = useRef(null);
    useEffect(()=>{
        if (!sizeDrawer) return;
        const closeOnOutsidePointer = (event)=>{
            const target = event.target;
            if (target instanceof Node && sizeTabsRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest('.size-drawer')) return;
            setSizeDrawer(null);
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        return ()=>document.removeEventListener('pointerdown', closeOnOutsidePointer);
    }, [
        sizeDrawer
    ]);
    const [sizeTier, setSizeTier] = useState('1k');
    const [count, setCount] = useState(1);
    const [quality, setQuality] = useState('自动');
    const [generateAdvancedOpen, setGenerateAdvancedOpen] = useState(false);
    const [customWidth, setCustomWidth] = useState(1024);
    const [customHeight, setCustomHeight] = useState(1024);
    const [generateRefs, setGenerateRefs] = useState([]);
    const [generateAutoReferenceSize, setGenerateAutoReferenceSize] = useState(null);
    const [generateUpscaleScale, setGenerateUpscaleScale] = useState(2);
    const [generateUpscaleTarget, setGenerateUpscaleTarget] = useState('auto');
    const [generateUpscaleSeed, setGenerateUpscaleSeed] = useState(42);
    const [generateUpscaleColorCorrection, setGenerateUpscaleColorCorrection] = useState('wavelet');
    const [generateUpscaleAlgorithm, setGenerateUpscaleAlgorithm] = useState('lanczos');
    const [generateUpscaleOutputFormat, setGenerateUpscaleOutputFormat] = useState('png');
    const [generateUpscaleOutputQuality, setGenerateUpscaleOutputQuality] = useState(95);
    const [generateUpscaleSourceSize, setGenerateUpscaleSourceSize] = useState(null);
    const [generateMask, setGenerateMask] = useState(null);
    const [maskEditorOpen, setMaskEditorOpen] = useState(false);
    const [editorMaskOpen, setEditorMaskOpen] = useState(false);
    const [outputFormat, setOutputFormat] = useState('png');
    const [backgroundMode, setBackgroundMode] = useState('auto');
    const [generateSettingsReady, setGenerateSettingsReady] = useState(false);
    const modelPreferencesRestoredRef = useRef(false);
    const [generateTasks, setGenerateTasks] = useState([]);
    const upscaleRecoveryRef = useRef(new Set());
    const [generateTasksReady, setGenerateTasksReady] = useState(false);
    const [generateClock, setGenerateClock] = useState(Date.now());
    const [resultItems, setResultItems] = useState([]);
    const [lastGenerateInfo, setLastGenerateInfo] = useState('');
    const [angleReference, setAngleReference] = useState(null);
    const [angleCameraSeed, setAngleCameraSeed] = useState(null);
    const [angleCameraStartSeed, setAngleCameraStartSeed] = useState(null);
    const [angleResults, setAngleResults] = useState([]);
    const [angleBusy, setAngleBusy] = useState(false);
    const [angleOpenBusy, setAngleOpenBusy] = useState(false);
    const angleOpenRequestRef = useRef('');
    const [angleResultToast, setAngleResultToast] = useState(null);
    const [angleResultOpenRequest, setAngleResultOpenRequest] = useState(null);
    const [angleSuppressAutoOpenId, setAngleSuppressAutoOpenId] = useState(null);
    const [gallery, setGallery] = useState([]);
    const [videoTasks, setVideoTasks] = useState([]);
    const [generationLogs, setGenerationLogs] = useState([]);
    const [historyNotice, setHistoryNotice] = useState(false);
    const [logErrorNotice, setLogErrorNotice] = useState(false);
    const navNoticeSeenRef = useRef({
        historySeenAt: 0,
        logErrorSeenAt: 0
    });
    const navNoticeStateReadyRef = useRef(false);
    const [logImageSpecs, setLogImageSpecs] = useState({});
    const [logFilter, setLogFilter] = useState('all');
    const [logSearch, setLogSearch] = useState('');
    const [logPage, setLogPage] = useState(1);
    const [selectedLog, setSelectedLog] = useState(null);
    const [localDirectoryHandle, setLocalDirectoryHandle] = useState(null);
    const [localDirectoryName, setLocalDirectoryName] = useState('');
    const [storagePath, setStoragePath] = useState('');
    const [storageUsage, setStorageUsage] = useState(null);
    const [localSnapshots, setLocalSnapshots] = useState([]);
    const [storageBusy, setStorageBusy] = useState(false);
    const [cleanupBusy, setCleanupBusy] = useState(false);
    const [backupBusy, setBackupBusy] = useState(false);
    const backupInputRef = useRef(null);
    const [historySearch, setHistorySearch] = useState('');
    const [historyFilter, setHistoryFilter] = useState('all');
    const [historyMediaFilter, setHistoryMediaFilter] = useState('all');
    const [recordTab, setRecordTab] = useState('works');
    const [pageSize, setPageSize] = useState(24);
    const [page, setPage] = useState(1);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedHistory, setSelectedHistory] = useState(new Set());
    const [viewerId, setViewerId] = useState(null);
    const [viewerZoom, setViewerZoom] = useState(1);
    const [viewerPan, setViewerPan] = useState({
        x: 0,
        y: 0
    });
    const [viewerImageSize, setViewerImageSize] = useState({
        width: 0,
        height: 0
    });
    const [viewerStageSize, setViewerStageSize] = useState({
        width: 0,
        height: 0
    });
    const viewerStageRef = useRef(null);
    const viewerDragRef = useRef({
        active: false,
        x: 0,
        y: 0,
        panX: 0,
        panY: 0
    });
    const [viewerDragging, setViewerDragging] = useState(false);
    const [compareState, setCompareState] = useState(null);
    const [editor, setEditor] = useState(null);
    const [upscaleSourceSize, setUpscaleSourceSize] = useState(null);
    const [outpaintEditor, setOutpaintEditor] = useState(null);
    useBodyScrollLock(Boolean(supportOpen || confirmState || messageReferencePreview || sharePreview || sizeDrawer || maskEditorOpen || editorMaskOpen || selectedLog || viewerId || compareState || editor || outpaintEditor));
    const activeProviderModels = useMemo(()=>filterModelsByActiveProviders(state.models, state.providers), [
        state.models,
        state.providers
    ]);
    const availableChatModels = useMemo(()=>activeProviderModels.filter((m)=>m.enabled && m.published && m.kind === 'chat' && !m.capabilities.includes('generate') && !m.capabilities.includes('upscale')), [
        activeProviderModels
    ]);
    const availableImageModels = useMemo(()=>activeProviderModels.filter((m)=>m.enabled && m.published && (m.kind === 'image' || m.capabilities.includes('generate') || m.capabilities.includes('upscale'))), [
        activeProviderModels
    ]);
    const availableVideoModels = useMemo(()=>activeProviderModels.filter((m)=>m.enabled && m.published && (m.kind === 'video' || m.capabilities.some((capability)=>capability.startsWith('video-')))), [
        activeProviderModels
    ]);
    const availableGenerationModels = useMemo(()=>availableImageModels.filter((m)=>m.capabilities.includes('generate')), [
        availableImageModels
    ]);
    const availableEditModels = useMemo(()=>availableImageModels.filter((m)=>m.capabilities.includes('edit')), [
        availableImageModels
    ]);
    const availableUpscaleModels = useMemo(()=>[
        ...availableImageModels.filter((m)=>m.capabilities.includes('upscale')),
        ...(state.upscaleModels || [])
    ], [
        availableImageModels,
        state.upscaleModels
    ]);
    const agentModel = availableChatModels.find((m)=>m.id === state.settings.agentModelId) || availableChatModels[0];
    const defaultImageModel = selectAutomaticModel(availableGenerationModels, state.settings.defaultProviderId, state.settings.defaultImageModelId);
    const defaultUpscaleModel = (state.upscaleModels || []).find((model)=>model.connected && model.id === 'tencent-super-resolution') || (state.upscaleModels || []).find((model)=>model.connected && model.id === 'aliyun-standard-super-resolution') || selectAutomaticModel(availableUpscaleModels.filter((model)=>!model.provider || !['tencent-ci', 'aliyun-viapi'].includes(model.provider) || model.connected), state.settings.defaultProviderId);
    const defaultProvider = state.providers.find((provider)=>provider.id === state.settings.defaultProviderId && isProviderModelLibraryEnabled(provider));
    const selectedGenerateModel = generateModelId !== 'auto' ? activeProviderModels.find((m)=>m.id === generateModelId) : defaultImageModel;
    const selectedUpscaleModel = generateUpscaleModelId !== 'auto' ? availableUpscaleModels.find((m)=>m.id === generateUpscaleModelId) : defaultUpscaleModel;
    function handleUpscaleModelChange(value) {
        setGenerateUpscaleModelId(value);
        const nextModel = value === 'auto' ? defaultUpscaleModel : availableUpscaleModels.find((model)=>model.id === value);
        const nextScales = nextModel?.scales || upscaleScales;
        if (!nextScales.includes(generateUpscaleScale)) setGenerateUpscaleScale(nextScales.includes(2) ? 2 : nextScales[0]);
        if (nextModel?.outputFormats && !nextModel.outputFormats.includes(generateUpscaleOutputFormat)) setGenerateUpscaleOutputFormat(nextModel.outputFormats[0]);
    }
    const generateUpscaleMode = generateWorkflow === 'upscale';
    const activeAgentModelId = agentModelId !== 'auto' && availableChatModels.some((model)=>model.id === agentModelId) ? agentModelId : 'auto';
    const activeAgentChatModel = activeAgentModelId === 'auto' ? agentModel : availableChatModels.find((model)=>model.id === activeAgentModelId);
    const matchingModels = useMemo(()=>activeProviderModels.filter((model)=>(modelProviderFilter === 'all' || model.providerId === modelProviderFilter) && (!modelSearch.trim() || `${model.displayName} ${model.rawId}`.toLowerCase().includes(modelSearch.trim().toLowerCase()))), [
        activeProviderModels,
        modelProviderFilter,
        modelSearch
    ]);
    const visibleModels = useMemo(()=>matchingModels.filter((model)=>modelKindFilter === 'all' || model.kind === modelKindFilter), [
        matchingModels,
        modelKindFilter
    ]);
    const modelKindCounts = useMemo(()=>({
            all: matchingModels.length,
            chat: matchingModels.filter((model)=>model.kind === 'chat').length,
            image: matchingModels.filter((model)=>model.kind === 'image').length,
            video: matchingModels.filter((model)=>model.kind === 'video').length,
            unknown: matchingModels.filter((model)=>model.kind === 'unknown').length
        }), [
        matchingModels
    ]);
    const modelProviderGroups = useMemo(()=>{
        const groups = new Map();
        for (const model of visibleModels)groups.set(model.providerId, [
            ...groups.get(model.providerId) || [],
            model
        ]);
        return [
            ...groups.entries()
        ].sort(([, left], [, right])=>left[0].providerName.localeCompare(right[0].providerName, 'zh-CN'));
    }, [
        visibleModels
    ]);
    useEffect(()=>{
        if (section !== 'models' || modelGroupsInitializedRef.current || !modelProviderGroups.length) return;
        setExpandedModelProviders(new Set(modelProviderGroups.map(([providerId])=>providerId)));
        modelGroupsInitializedRef.current = true;
    }, [
        section,
        modelProviderGroups
    ]);
    useEffect(()=>{
        const sync = ()=>setModelFavorites(getFavoriteModelIds());
        sync();
        return subscribeModelPreferences(sync);
    }, []);
    const filteredGallery = useMemo(()=>gallery.filter((item)=>{
            const q = historySearch.trim().toLowerCase();
            const matchSearch = !q || item.prompt.toLowerCase().includes(q) || (item.modelName || '').toLowerCase().includes(q);
            const matchMedia = historyMediaFilter === 'all' || historyMediaFilter === 'image';
            const matchFilter = historyFilter === 'all' || (historyFilter === 'favorite' ? item.favorite : item.source === historyFilter);
            return matchSearch && matchMedia && matchFilter;
        }), [
        gallery,
        historySearch,
        historyFilter,
        historyMediaFilter
    ]);
    const visibleVideoTasks = useMemo(()=>videoTasks.filter((task)=>{
            const q = historySearch.trim().toLowerCase();
            const matchSearch = !q || `${task.input?.prompt || ''} ${task.modelName || ''}`.toLowerCase().includes(q);
            const matchMedia = historyMediaFilter === 'all' || historyMediaFilter === 'video';
            const matchSource = historyFilter === 'all'
                ? true
                : historyFilter === 'canvas'
                    ? task.source === 'canvas'
                    : historyFilter === 'generate'
                        ? !task.source || task.source === 'workspace'
                        : historyFilter === 'agent'
                            ? task.source === 'agent'
                            : false;
            return matchSearch && matchMedia && matchSource;
        }), [
        videoTasks,
        historySearch,
        historyMediaFilter,
        historyFilter
    ]);
    const hasCreativeRecords = filteredGallery.length > 0 || visibleVideoTasks.length > 0;
    const logSummary = useMemo(()=>{
        const completed = generationLogs.filter((log)=>log.status !== 'pending');
        const success = generationLogs.filter((log)=>log.status === 'success').length;
        const durations = completed.map((log)=>log.durationMs).filter((value)=>typeof value === 'number' && value > 0);
        return {
            total: generationLogs.length,
            pending: generationLogs.filter((log)=>log.status === 'pending').length,
            success,
            error: generationLogs.filter((log)=>log.status === 'error').length,
            successRate: completed.length ? Math.round(success / completed.length * 100) : 0,
            averageDuration: durations.length ? `${(durations.reduce((sum, value)=>sum + value, 0) / durations.length / 1000).toFixed(1)}s` : '—'
        };
    }, [
        generationLogs
    ]);
    const filteredGenerationLogs = useMemo(()=>{
        const query = logSearch.trim().toLowerCase();
        return generationLogs.filter((log)=>{
            const matchesStatus = logFilter === 'all' || log.status === logFilter;
            const matchesMedia = historyMediaFilter === 'all' || generationMediaKind(log) === historyMediaFilter;
            const matchesQuery = !query || `${log.prompt || ''} ${log.modelName || ''} ${log.providerName || ''} ${generationLogSourceLabel(log)}`.toLowerCase().includes(query);
            return matchesStatus && matchesMedia && matchesQuery;
        });
    }, [
        generationLogs,
        logFilter,
        logSearch,
        historyMediaFilter
    ]);
    const logTotalPages = Math.max(1, Math.ceil(filteredGenerationLogs.length / generationLogPageSize));
    const pagedGenerationLogs = useMemo(()=>filteredGenerationLogs.slice((Math.min(logPage, logTotalPages) - 1) * generationLogPageSize, Math.min(logPage, logTotalPages) * generationLogPageSize), [
        filteredGenerationLogs,
        logPage,
        logTotalPages
    ]);
    const conversationItems = useMemo(()=>messages.filter((message)=>message.role === 'user').map((message, index)=>({
                id: message.id,
                index: index + 1,
                text: message.content.replace(/\s+/g, ' ').trim() || '空消息'
            })), [
        messages
    ]);
    useEffect(()=>{
        if (conversationItems.length > 0) return;
        if (conversationNavCloseTimerRef.current) window.clearTimeout(conversationNavCloseTimerRef.current);
        conversationNavCloseTimerRef.current = 0;
        conversationNavCloseAfterClickRef.current = false;
        setConversationNavOpen(false);
    }, [
        conversationItems.length
    ]);
    const shareGroups = useMemo(()=>buildShareConversationGroups(messages), [
        messages
    ]);
    const shareGroupByMessageId = useMemo(()=>new Map(shareGroups.flatMap((group)=>group.messageIds.map((id)=>[
                id,
                group
            ]))), [
        shareGroups
    ]);
    const selectableShareGroups = useMemo(()=>shareGroups.filter((group)=>group.selectable), [
        shareGroups
    ]);
    const selectedShareMessages = useMemo(()=>flattenSelectedShareMessages(shareGroups, selectedShareGroups), [
        shareGroups,
        selectedShareGroups
    ]);
    const allShareGroupsSelected = selectableShareGroups.length > 0 && selectableShareGroups.every((group)=>selectedShareGroups.has(group.id));
    const filteredChatSessions = useMemo(()=>{
        const query = chatHistorySearch.trim().toLowerCase();
        if (!query) return chatSessions;
        return chatSessions.filter((session)=>`${session.title} ${session.messages.map((message)=>message.content).join(' ')}`.toLowerCase().includes(query));
    }, [
        chatSessions,
        chatHistorySearch
    ]);
    const selectableChatSessionIds = useMemo(()=>chatSessions.filter((session)=>!busyChatIds.includes(session.id)).map((session)=>session.id), [
        chatSessions,
        busyChatIds
    ]);
    const allChatSessionsSelected = selectableChatSessionIds.length > 0 && selectableChatSessionIds.every((id)=>selectedChatSessions.has(id));
    const activeAgentBusy = activeChatId ? busyChatIds.includes(activeChatId) : false;
    const agentMessageSelectionActive = agentMessageSelectionMode || shareSelectionMode;
    const totalPages = Math.max(1, Math.ceil(filteredGallery.length / pageSize));
    const pagedGallery = useMemo(()=>filteredGallery.slice((Math.min(page, totalPages) - 1) * pageSize, Math.min(page, totalPages) * pageSize), [
        filteredGallery,
        page,
        totalPages,
        pageSize
    ]);
    const viewerItems = section === 'history' ? pagedGallery : resultItems.length ? resultItems : gallery;
    const viewerIndex = viewerId ? viewerItems.findIndex((item)=>item.id === viewerId) : -1;
    const viewerItem = viewerIndex >= 0 ? viewerItems[viewerIndex] : null;
    const viewerReferences = viewerItem ? galleryReferences(viewerItem) : [];
    const viewerComparisonSource = viewerItem ? getComparisonSource(viewerItem) : null;
    const viewerParentItem = viewerComparisonSource?.item || null;
    const effectiveAutoRatio = ratio === '自动' && generateRefs.length === 1 && generateAutoReferenceSize ? exactRatioFromDimensions(generateAutoReferenceSize.width, generateAutoReferenceSize.height) : '自动';
    const selectedRatioLabel = ratioLabel(ratio === '自动' && effectiveAutoRatio !== '自动' ? effectiveAutoRatio : ratio, customRatioWidth, customRatioHeight);
    const selectedPresetSize = useMemo(()=>presetDimensions(ratio === '自动' ? effectiveAutoRatio : ratio, sizeTier, customRatioWidth, customRatioHeight), [
        ratio,
        effectiveAutoRatio,
        sizeTier,
        customRatioWidth,
        customRatioHeight
    ]);
    const generateUpscaleTargetPreview = useMemo(()=>upscalePreviewDimensions(generateUpscaleSourceSize, generateUpscaleScale, selectedUpscaleModel, generateUpscaleTarget), [
        generateUpscaleSourceSize,
        generateUpscaleScale,
        generateUpscaleTarget,
        selectedUpscaleModel
    ]);
    const viewerDisplaySize = useMemo(()=>{
        if (!viewerImageSize.width || !viewerImageSize.height || !viewerStageSize.width || !viewerStageSize.height) return {
            width: 0,
            height: 0
        };
        const fit = Math.min((viewerStageSize.width - 40) / viewerImageSize.width, (viewerStageSize.height - 40) / viewerImageSize.height, 1);
        return {
            width: Math.max(1, Math.round(viewerImageSize.width * fit * viewerZoom)),
            height: Math.max(1, Math.round(viewerImageSize.height * fit * viewerZoom))
        };
    }, [
        viewerImageSize,
        viewerStageSize,
        viewerZoom
    ]);
    const editorDisplayRatio = editor ? editorRatio(editor) : '1:1';
    const editorDisplaySize = editor ? editor.sizeMode === 'custom' ? {
        width: editor.customWidth,
        height: editor.customHeight
    } : presetDimensions(editorDisplayRatio, editor.sizeTier) : {
        width: 0,
        height: 0
    };
    const upscaleTargetPreview = useMemo(()=>editor?.mode === 'upscale' && upscaleSourceSize ? upscalePreviewDimensions(upscaleSourceSize, editor.scale, availableUpscaleModels.find((model)=>model.id === editor.modelId) || defaultUpscaleModel, editor.targetSize) : null, [
        editor?.mode,
        editor?.scale,
        editor?.targetSize,
        editor?.modelId,
        upscaleSourceSize,
        availableUpscaleModels,
        defaultUpscaleModel
    ]);
    const activeGenerateTasks = useMemo(()=>generateTasks.filter((task)=>task.status === 'pending'), [
        generateTasks
    ]);
    const generateBusy = activeGenerateTasks.length > 0;
    const agentWebSearchAvailable = Boolean(state.settings.webSearchConfigured) || Boolean(activeAgentChatModel?.capabilities.includes('web-search'));
    const nativeWebSearchModelActive = Boolean(activeAgentChatModel?.capabilities.includes('web-search'));
    const agentWebSearchActive = agentWebMode !== 'off' && agentWebSearchAvailable;
    const nativeWebSearchHint = nativeWebSearchModelActive
        ? '当前模型自带联网搜索，将优先使用模型原生能力；失败时自动回退外部搜索 API'
        : '当前使用外部搜索 API；切换到带“原生联网”标签的模型后会优先使用模型自身搜索';
    useEffect(()=>{
        let cancelled = false;
        let stopWorkspaceSync = ()=>{};
        const start = async ()=>{
            await bootstrapWorkspace();
            if (cancelled) return;
            initializeNavNoticeState();
            try {
            const savedSection = localStorage.getItem(LAST_SECTION_STORAGE_KEY);
            if (isRememberedSection(savedSection)) {
                if (savedSection === 'logs') setRecordTab('tasks');
                lastNonAngleSectionRef.current = savedSection;
                sectionRef.current = savedSection;
                setSectionState(savedSection);
            }
            const saved = localStorage.getItem('sanmao-theme');
            const initial = saved === 'dark' ? 'dark' : 'light';
            setTheme(initial);
            document.documentElement.dataset.theme = initial;
            document.documentElement.style.colorScheme = initial;
            setSuccessSoundEnabled(localStorage.getItem('sanmao-success-sound') === '1');
            const savedWebMode = localStorage.getItem('sanmao-agent-web-mode');
            const savedWebSearch = localStorage.getItem('sanmao-agent-web-search');
            if (savedWebMode === 'auto' || savedWebMode === 'always' || savedWebMode === 'off') setAgentWebMode(savedWebMode);
            else if (savedWebSearch !== null) setAgentWebMode(savedWebSearch === '0' ? 'off' : 'auto');
            const savedSize = Number(localStorage.getItem('sanmao-history-page-size') || 24);
            if ([
                12,
                24,
                48,
                96
            ].includes(savedSize)) setPageSize(savedSize);
            const savedGeneration = JSON.parse(localStorage.getItem('sanmao-generate-settings') || 'null');
            if (savedGeneration) {
                // 模型选择由提交后的统一偏好记录恢复；不能因为旧版参数缓存而覆盖“自动”模式。
                if (typeof savedGeneration.upscaleModelId === 'string') setGenerateUpscaleModelId(savedGeneration.upscaleModelId);
                if (typeof savedGeneration.ratio === 'string' && ratios.includes(savedGeneration.ratio)) setRatio(savedGeneration.ratio);
                if (typeof savedGeneration.customRatioWidth === 'number' && savedGeneration.customRatioWidth > 0) setCustomRatioWidth(Math.round(savedGeneration.customRatioWidth));
                if (typeof savedGeneration.customRatioHeight === 'number' && savedGeneration.customRatioHeight > 0) setCustomRatioHeight(Math.round(savedGeneration.customRatioHeight));
                if (savedGeneration.sizeMode === 'system' || savedGeneration.sizeMode === 'custom') setSizeMode(savedGeneration.sizeMode);
                if (sizeTiers.some((item)=>item.value === savedGeneration.sizeTier)) setSizeTier(savedGeneration.sizeTier);
                if (typeof savedGeneration.count === 'number' && savedGeneration.count >= 1 && savedGeneration.count <= 8) setCount(Math.round(savedGeneration.count));
                if (typeof savedGeneration.quality === 'string') setQuality(savedGeneration.quality);
                if (typeof savedGeneration.customWidth === 'number' && savedGeneration.customWidth > 0) setCustomWidth(Math.round(savedGeneration.customWidth));
                if (typeof savedGeneration.customHeight === 'number' && savedGeneration.customHeight > 0) setCustomHeight(Math.round(savedGeneration.customHeight));
                if (savedGeneration.outputFormat === 'png' || savedGeneration.outputFormat === 'jpeg' || savedGeneration.outputFormat === 'webp') setOutputFormat(savedGeneration.outputFormat);
                if (savedGeneration.backgroundMode === 'auto' || savedGeneration.backgroundMode === 'api-transparent' || savedGeneration.backgroundMode === 'local-transparent' || savedGeneration.backgroundMode === 'opaque') setBackgroundMode(savedGeneration.backgroundMode);
                if ([
                    1,
                    2,
                    3,
                    4
                ].includes(savedGeneration.upscaleScale)) setGenerateUpscaleScale(savedGeneration.upscaleScale);
                if (savedGeneration.upscaleTarget === 'auto' || savedGeneration.upscaleTarget === '1K' || savedGeneration.upscaleTarget === '2K' || savedGeneration.upscaleTarget === '4K') setGenerateUpscaleTarget(savedGeneration.upscaleTarget);
                if (typeof savedGeneration.upscaleSeed === 'number') setGenerateUpscaleSeed(Math.round(savedGeneration.upscaleSeed));
                if (savedGeneration.upscaleColorCorrection === 'wavelet' || savedGeneration.upscaleColorCorrection === 'none') setGenerateUpscaleColorCorrection(savedGeneration.upscaleColorCorrection);
                if (savedGeneration.upscaleAlgorithm === 'lanczos' || savedGeneration.upscaleAlgorithm === 'bicubic' || savedGeneration.upscaleAlgorithm === 'nearest') setGenerateUpscaleAlgorithm(savedGeneration.upscaleAlgorithm);
                if (savedGeneration.upscaleOutputFormat === 'png' || savedGeneration.upscaleOutputFormat === 'jpg' || savedGeneration.upscaleOutputFormat === 'bmp') setGenerateUpscaleOutputFormat(savedGeneration.upscaleOutputFormat);
                if (typeof savedGeneration.upscaleOutputQuality === 'number' && savedGeneration.upscaleOutputQuality >= 30 && savedGeneration.upscaleOutputQuality <= 100) setGenerateUpscaleOutputQuality(Math.round(savedGeneration.upscaleOutputQuality));
            }
            const savedTasks = JSON.parse(localStorage.getItem('sanmao-generate-tasks') || 'null');
            if (Array.isArray(savedTasks)) {
                const restoredAt = Date.now();
                const tasks = savedTasks.filter((task)=>typeof task?.id === 'string' && typeof task?.prompt === 'string').slice(0, 12).map((task)=>{
                    const pending = task.status === 'pending';
                    return {
                        id: task.id,
                        status: pending ? 'error' : task.status === 'success' ? 'success' : 'error',
                        mode: task.mode === 'edit' || task.mode === 'upscale' ? task.mode : 'generate',
                        prompt: task.prompt,
                        expectedCount: Math.max(1, Number(task.expectedCount) || 1),
                        startedAt: Number(task.startedAt) || restoredAt,
                        completedAt: pending ? restoredAt : Number(task.completedAt) || undefined,
                        info: pending ? `${task.info || '生图任务'} · 页面刷新后已中断` : String(task.info || '生图任务'),
                        error: pending ? '页面刷新导致本轮任务中断，已保留已经返回的图片。可恢复参数后重新提交。' : typeof task.error === 'string' ? task.error : undefined,
                        interrupted: pending,
                        items: [],
                        itemIds: Array.isArray(task.itemIds) ? task.itemIds.filter((id)=>typeof id === 'string') : [],
                        request: task.request
                    };
                });
                setGenerateTasks(tasks);
            }
            } catch  {}
            setGenerateSettingsReady(true);
            setGenerateTasksReady(true);
            void refreshState();
            void refreshAdmin();
            void refreshGallery();
            void refreshChatSessions();
            void refreshGenerationLogs();
            void refreshVideoTasks();
            void refreshStorageMaintenance();
            void loadLocalDirectory();
            stopWorkspaceSync = startWorkspaceSync();
        };
        void start();
        return ()=>{
            cancelled = true;
            stopWorkspaceSync();
        };
    }, []);
    useEffect(()=>{
        if (!generateSettingsReady) return;
        const settings = {
            modelId: generateModelId,
            upscaleModelId: generateUpscaleModelId,
            ratio,
            customRatioWidth,
            customRatioHeight,
            sizeMode,
            sizeTier,
            count,
            quality,
            customWidth,
            customHeight,
            outputFormat,
            backgroundMode,
            upscaleScale: generateUpscaleScale,
            upscaleTarget: generateUpscaleTarget,
            upscaleSeed: generateUpscaleSeed,
            upscaleColorCorrection: generateUpscaleColorCorrection,
            upscaleAlgorithm: generateUpscaleAlgorithm,
            upscaleOutputFormat: generateUpscaleOutputFormat,
            upscaleOutputQuality: generateUpscaleOutputQuality
        };
        try {
            localStorage.setItem('sanmao-generate-settings', JSON.stringify(settings));
        } catch  {}
    }, [
        generateSettingsReady,
        generateModelId,
        generateUpscaleModelId,
        ratio,
        customRatioWidth,
        customRatioHeight,
        sizeMode,
        sizeTier,
        count,
        quality,
        customWidth,
        customHeight,
        outputFormat,
        backgroundMode,
        generateUpscaleScale,
        generateUpscaleTarget,
        generateUpscaleSeed,
        generateUpscaleColorCorrection,
        generateUpscaleAlgorithm,
        generateUpscaleOutputFormat,
        generateUpscaleOutputQuality
    ]);
    useEffect(()=>{
        if (modelPreferencesRestoredRef.current || !state.models.length) return;
        modelPreferencesRestoredRef.current = true;
        const supports = (modelId, capability)=>Boolean(modelId && activeProviderModels.some((model)=>model.id === modelId && model.enabled && model.published && model.capabilities.includes(capability)));
        const restored = [];
        const agentCall = getLastModelCall('agent');
        if (agentCall) {
            setAgentModelId(agentCall.mode === 'manual' && supports(agentCall.modelId, 'chat') ? agentCall.modelId : 'auto');
            if (agentCall.params.webMode === 'auto' || agentCall.params.webMode === 'always' || agentCall.params.webMode === 'off') setAgentWebMode(agentCall.params.webMode);
            else if (typeof agentCall.params.webSearch === 'boolean') setAgentWebMode(agentCall.params.webSearch ? 'auto' : 'off');
            restored.push('助手');
        }
        const generateCall = getLastModelCall('generate');
        if (generateCall) {
            setGenerateModelId(generateCall.mode === 'manual' && supports(generateCall.modelId, 'generate') ? generateCall.modelId : 'auto');
            const params = generateCall.params;
            if (typeof params.ratio === 'string' && ratios.includes(params.ratio)) setRatio(params.ratio);
            if (typeof params.customRatioWidth === 'number' && params.customRatioWidth > 0) setCustomRatioWidth(Math.round(params.customRatioWidth));
            if (typeof params.customRatioHeight === 'number' && params.customRatioHeight > 0) setCustomRatioHeight(Math.round(params.customRatioHeight));
            if (params.sizeMode === 'system' || params.sizeMode === 'custom') setSizeMode(params.sizeMode);
            if (sizeTiers.some((item)=>item.value === params.sizeTier)) setSizeTier(params.sizeTier);
            if (typeof params.count === 'number' && params.count >= 1 && params.count <= 8) setCount(Math.round(params.count));
            if (typeof params.quality === 'string') setQuality(params.quality);
            if (typeof params.customWidth === 'number' && params.customWidth > 0) setCustomWidth(Math.round(params.customWidth));
            if (typeof params.customHeight === 'number' && params.customHeight > 0) setCustomHeight(Math.round(params.customHeight));
            if (params.outputFormat === 'png' || params.outputFormat === 'jpeg' || params.outputFormat === 'webp') setOutputFormat(params.outputFormat);
            if (params.backgroundMode === 'auto' || params.backgroundMode === 'api-transparent' || params.backgroundMode === 'local-transparent' || params.backgroundMode === 'opaque') setBackgroundMode(params.backgroundMode);
            if ([
                1,
                2,
                3,
                4
            ].includes(params.upscaleScale)) setGenerateUpscaleScale(params.upscaleScale);
            if (params.upscaleTarget === 'auto' || params.upscaleTarget === '1K' || params.upscaleTarget === '2K' || params.upscaleTarget === '4K') setGenerateUpscaleTarget(params.upscaleTarget);
            if (typeof params.upscaleSeed === 'number') setGenerateUpscaleSeed(Math.round(params.upscaleSeed));
            if (params.upscaleColorCorrection === 'wavelet' || params.upscaleColorCorrection === 'none') setGenerateUpscaleColorCorrection(params.upscaleColorCorrection);
            if (params.upscaleAlgorithm === 'lanczos' || params.upscaleAlgorithm === 'bicubic' || params.upscaleAlgorithm === 'nearest') setGenerateUpscaleAlgorithm(params.upscaleAlgorithm);
            if (params.upscaleOutputFormat === 'png' || params.upscaleOutputFormat === 'jpg' || params.upscaleOutputFormat === 'bmp') setGenerateUpscaleOutputFormat(params.upscaleOutputFormat);
            if (typeof params.upscaleOutputQuality === 'number' && params.upscaleOutputQuality >= 30 && params.upscaleOutputQuality <= 100) setGenerateUpscaleOutputQuality(Math.round(params.upscaleOutputQuality));
            restored.push('生图');
        }
        const upscaleCall = getLastModelCall('upscale');
        if (upscaleCall) setGenerateUpscaleModelId(upscaleCall.mode === 'manual' && supports(upscaleCall.modelId, 'upscale') ? upscaleCall.modelId : 'auto');
        if (restored.length) notify(`已恢复上次${restored.join('、')}设置`);
    }, [
        activeProviderModels,
        notify
    ]);
    useEffect(()=>{
        if (!generateTasksReady) return;
        const compactTasks = generateTasks.slice(0, 12).map((task)=>{
            const request = task.request ? {
                ...task.request
            } : undefined;
            if (request) {
                const referenceBytes = request.references.reduce((total, ref)=>total + (ref.dataUrl?.length || 0), 0) + (request.mask?.dataUrl?.length || 0);
                if (referenceBytes > 2500000) {
                    request.references = [];
                    request.mask = null;
                    request.referencesOmitted = true;
                }
            }
            return {
                ...task,
                items: [],
                itemIds: task.itemIds?.length ? task.itemIds : task.items.map((item)=>item.id),
                request
            };
        });
        try {
            localStorage.setItem('sanmao-generate-tasks', JSON.stringify(compactTasks));
        } catch  {
            try {
                localStorage.setItem('sanmao-generate-tasks', JSON.stringify(compactTasks.map((task)=>({
                        ...task,
                        request: task.request ? {
                            ...task.request,
                            references: [],
                            mask: null,
                            referencesOmitted: true
                        } : undefined
                    }))));
            } catch  {}
        }
    }, [
        generateTasksReady,
        generateTasks
    ]);
    useEffect(()=>{
        if (!generateTasksReady || !gallery.length) return;
        const byId = new Map(gallery.map((item)=>[
                item.id,
                item
            ]));
        setGenerateTasks((old)=>old.map((task)=>{
                if (!task.itemIds?.length) return task;
                const items = task.itemIds.map((id)=>byId.get(id)).filter((item)=>Boolean(item));
                if (items.length === task.items.length && items.every((item, index)=>item.id === task.items[index]?.id)) return task;
                return {
                    ...task,
                    items
                };
            }));
    }, [
        generateTasksReady,
        gallery
    ]);
    useEffect(()=>{
        if (!generateTasksReady) return;
        const pending = generateTasks.filter((task)=>task.mode === 'upscale' && task.upscaleTaskId && task.status !== 'success' && task.status !== 'error' && !upscaleRecoveryRef.current.has(task.upscaleTaskId));
        for (const task of pending) {
            upscaleRecoveryRef.current.add(task.upscaleTaskId);
            void waitForUpscaleTask(task.upscaleTaskId, { taskId: task.upscaleTaskId }).then(async (data)=>{
                if (!data.images?.length || gallery.some((item)=>item.upscaleTaskId === task.upscaleTaskId)) return;
                const sourceImageId = task.request?.sourceImageId || task.request?.references?.[0]?.id;
                const items = await recordImages(data.images, {
                    prompt: task.prompt || 'Upscale this image',
                    modelId: data.model?.id,
                    modelName: data.model?.name,
                    providerName: data.model?.provider,
                    outputSize: `${task.request?.upscaleScale || 2}× 超分`,
                    source: 'upscale',
                    parentId: sourceImageId,
                    sourceImageId,
                    upscaleProvider: data.model?.provider,
                    upscaleModel: data.model?.id,
                    upscaleScale: task.request?.upscaleScale || 2,
                    upscaleTaskId: task.upscaleTaskId
                });
                setResultItems((old)=>[...items, ...old]);
                patchGenerateTask(task.id, { status: 'success', completedAt: Date.now(), items, itemIds: items.map((item)=>item.id), info: `${data.model?.name || '高清放大'} · 已恢复完成` });
                notify('已恢复完成的高清放大任务。');
            }).catch((error)=>patchGenerateTask(task.id, { status: 'error', completedAt: Date.now(), error: error instanceof Error ? error.message : '高清任务恢复失败' })).finally(()=>upscaleRecoveryRef.current.delete(task.upscaleTaskId));
        }
    }, [generateTasksReady, generateTasks, gallery]);
    useEffect(()=>{
        const updateChatScrollState = ()=>{
            const nearBottom = isChatNearBottom();
            const pendingScroll = chatScrollAfterCommitRef.current;
            setChatNearBottom(nearBottom || pendingScroll);
            if (!nearBottom && !pendingScroll) chatAutoFollowRef.current = false;
        };
        updateChatScrollState();
        window.addEventListener('scroll', updateChatScrollState, {
            passive: true
        });
        window.addEventListener('resize', updateChatScrollState);
        return ()=>{
            window.removeEventListener('scroll', updateChatScrollState);
            window.removeEventListener('resize', updateChatScrollState);
        };
    }, [
        messages.length,
        section
    ]);
    useEffect(()=>{
        if (section !== 'agent') return;
        const pendingScroll = chatScrollAfterCommitRef.current;
        if (!chatAutoFollowRef.current && !pendingScroll) return;
        if (pendingScroll) {
            chatAutoFollowRef.current = true;
        }
        scheduleChatScrollToEnd();
    }, [
        messages,
        section,
        activeChatId
    ]);
    useEffect(()=>{
        if (section === 'agent') return;
        cancelScheduledChatScroll();
        chatScrollAfterCommitRef.current = false;
    }, [section]);
    useEffect(()=>{
        setPage(1);
    }, [
        historySearch,
        historyFilter,
        historyMediaFilter,
        pageSize
    ]);
    useEffect(()=>{
        setLogPage(1);
    }, [
        logFilter,
        logSearch,
        historyMediaFilter
    ]);
    useEffect(()=>{
        if (logPage > logTotalPages) setLogPage(logTotalPages);
    }, [
        logPage,
        logTotalPages
    ]);
    useEffect(()=>{
        if (selectedLog) {
            const latest = generationLogs.find((log)=>log.id === selectedLog.id);
            if (latest && latest !== selectedLog) setSelectedLog(latest);
        }
    }, [
        generationLogs,
        selectedLog
    ]);
    useEffect(()=>{
        if (section !== 'agent') setSelectionPush(null);
    }, [
        section
    ]);
    useEffect(()=>{
        if (!selectionPush) return;
        const closeOnOutsidePointer = (event)=>{
            const target = event.target;
            if (!(target instanceof Element) || !target.closest('.selection-push')) setSelectionPush(null);
        };
        const closeOnEscape = (event)=>{
            if (event.key === 'Escape') setSelectionPush(null);
        };
        const closeOnViewportChange = ()=>setSelectionPush(null);
        document.addEventListener('pointerdown', closeOnOutsidePointer);
        document.addEventListener('keydown', closeOnEscape);
        window.addEventListener('scroll', closeOnViewportChange, true);
        window.addEventListener('resize', closeOnViewportChange);
        return ()=>{
            document.removeEventListener('pointerdown', closeOnOutsidePointer);
            document.removeEventListener('keydown', closeOnEscape);
            window.removeEventListener('scroll', closeOnViewportChange, true);
            window.removeEventListener('resize', closeOnViewportChange);
        };
    }, [
        selectionPush
    ]);
    useEffect(()=>{
        if (section === 'history') markHistoryNoticeSeen();
        if (section === 'logs') markLogErrorNoticeSeen();
    }, [
        section
    ]);
    useEffect(()=>{
        if (section !== 'angle' && angleSuppressAutoOpenId) setAngleSuppressAutoOpenId(null);
    }, [
        section,
        angleSuppressAutoOpenId
    ]);
    useEffect(()=>{
        if (!sidebarOpen) return;
        const closeOnEscape = (event)=>{
            if (event.key === 'Escape') {
                setSidebarOpen(false);
                setRenamingChatId(null);
                setRenamingChatTitle('');
            }
        };
        window.addEventListener('keydown', closeOnEscape);
        return ()=>window.removeEventListener('keydown', closeOnEscape);
    }, [
        sidebarOpen
    ]);
    useEffect(()=>{
        if (section !== 'agent') {
            setRenamingChatId(null);
            setRenamingChatTitle('');
        }
    }, [
        section
    ]);
    useEffect(()=>{
        if (angleOpenBusy && (section !== 'angle' || !angleReference || !angleReference.pending)) {
            angleOpenRequestRef.current = '';
            setAngleOpenBusy(false);
        }
    }, [
        section,
        angleOpenBusy,
        angleReference
    ]);
    useEffect(()=>{
        const handleOutpaint = (event)=>{
            const item = event.detail;
            if (item?.id) openOutpaintEditor(item);
        };
        const handleAngle = (event)=>{
            const item = event.detail;
            if (item?.id) void openAngleConsole(item);
        };
        window.addEventListener('sanmao-outpaint', handleOutpaint);
        window.addEventListener('sanmao-angle', handleAngle);
        return ()=>{
            window.removeEventListener('sanmao-outpaint', handleOutpaint);
            window.removeEventListener('sanmao-angle', handleAngle);
        };
    }, []);
    useEffect(()=>{
        if (!generateBusy && section !== 'logs') return;
        const timer = window.setInterval(()=>{
            setGenerateClock(Date.now());
            void refreshGenerationLogs();
            if (section === 'logs') void refreshVideoTasks();
        }, 1000);
        return ()=>window.clearInterval(timer);
    }, [
        generateBusy,
        section
    ]);
    useEffect(()=>{
        if (!generateMask) return;
        if (generateRefs.length !== 1) {
            setGenerateMask(null);
            notify('绘制蒙版仅支持上传 1 张参考图，原蒙版已清除');
            return;
        }
        if (generateRefs[0]?.id !== generateMask.referenceId) {
            setGenerateMask(null);
            notify('第一张参考图已变化，原蒙版已清除');
        }
    }, [
        generateRefs,
        generateMask
    ]);
    useEffect(()=>{
        if (generateUpscaleMode) setGeneratePromptBeforeOptimization(null);
    }, [
        generateUpscaleMode
    ]);
    useEffect(()=>{
        let active = true;
        if (!generateUpscaleMode || !generateRefs[0]) {
            setGenerateUpscaleSourceSize(null);
            return ()=>{
                active = false;
            };
        }
        void loadImageDimensions(generateRefs[0].dataUrl).then((size)=>{
            if (active) setGenerateUpscaleSourceSize(size);
        }).catch(()=>{
            if (active) setGenerateUpscaleSourceSize(null);
        });
        return ()=>{
            active = false;
        };
    }, [
        generateUpscaleMode,
        generateRefs
    ]);
    useEffect(()=>{
        let active = true;
        if (generateRefs.length !== 1) {
            setGenerateAutoReferenceSize(null);
            return ()=>{
                active = false;
            };
        }
        void loadImageDimensions(generateRefs[0].dataUrl).then((size)=>{
            if (active) setGenerateAutoReferenceSize(size);
        }).catch(()=>{
            if (active) setGenerateAutoReferenceSize(null);
        });
        return ()=>{
            active = false;
        };
    }, [
        generateRefs
    ]);
    useEffect(()=>{
        setViewerZoom(1);
        setViewerImageSize({
            width: 0,
            height: 0
        });
        viewerStageRef.current?.scrollTo({
            left: 0,
            top: 0
        });
    }, [
        viewerId
    ]);
    useEffect(()=>{
        if (editor?.mode !== 'upscale') {
            setUpscaleSourceSize(null);
            return;
        }
        let cancelled = false;
        setUpscaleSourceSize(null);
        void loadImageDimensions(editor.item.url).then((size)=>{
            if (!cancelled) setUpscaleSourceSize(size);
        }).catch(()=>undefined);
        return ()=>{
            cancelled = true;
        };
    }, [
        editor?.mode,
        editor?.item.url
    ]);
    useEffect(()=>{
        if (!viewerItem || !viewerStageRef.current) return;
        const stage = viewerStageRef.current;
        const update = ()=>setViewerStageSize({
                width: stage.clientWidth,
                height: stage.clientHeight
            });
        update();
        const observer = new ResizeObserver(update);
        observer.observe(stage);
        return ()=>observer.disconnect();
    }, [
        viewerItem
    ]);
    useEffect(()=>{
        setViewerPan({
            x: 0,
            y: 0
        });
    }, [
        viewerId
    ]);
    useEffect(()=>{
        const input = agentInputRef.current;
        if (!input) return;
        const minHeight = 58;
        const maxHeight = 320;
        input.style.height = 'auto';
        const nextHeight = Math.min(Math.max(input.scrollHeight, minHeight), maxHeight);
        input.style.height = `${nextHeight}px`;
        input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
    }, [
        agentInput
    ]);
    useEffect(()=>{
        const composer = agentComposerRef.current;
        if (!composer || typeof ResizeObserver === 'undefined') return;
        const updateComposerHeight = ()=>{
            document.documentElement.style.setProperty('--agent-composer-height', `${composer.getBoundingClientRect().height}px`);
        };
        updateComposerHeight();
        const observer = new ResizeObserver(updateComposerHeight);
        observer.observe(composer);
        return ()=>{
            observer.disconnect();
            document.documentElement.style.removeProperty('--agent-composer-height');
        };
    }, [
        section
    ]);
    function notify(text) {
        if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
        setToast(text);
        toastTimerRef.current = window.setTimeout(()=>{
            setToast('');
            toastTimerRef.current = null;
        }, 3000);
    }
    function lastChatMessageElement() {
        const lastMessage = messages[messages.length - 1];
        return lastMessage ? document.getElementById(`message-${lastMessage.id}`) : null;
    }
    function chatComposerTop() {
        const top = agentComposerRef.current?.getBoundingClientRect().top;
        return typeof top === 'number' && Number.isFinite(top) ? Math.min(window.innerHeight, top) : window.innerHeight;
    }
    function isChatNearBottom() {
        const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        if (documentHeight - window.scrollY - window.innerHeight < 120) return true;
        const lastMessage = lastChatMessageElement();
        if (lastMessage) {
            const targetBottom = Math.max(0, chatComposerTop() - 20);
            return Math.abs(lastMessage.getBoundingClientRect().bottom - targetBottom) < 120;
        }
        return false;
    }
    function cancelScheduledChatScroll() {
        const frames = chatScrollFramesRef.current;
        if (frames.first) window.cancelAnimationFrame(frames.first);
        if (frames.second) window.cancelAnimationFrame(frames.second);
        chatScrollFramesRef.current = { first: 0, second: 0 };
    }
    function scheduleChatScrollToEnd() {
        const frames = chatScrollFramesRef.current;
        if (frames.first || frames.second) return;
        frames.first = window.requestAnimationFrame(()=>{
            frames.first = 0;
            frames.second = window.requestAnimationFrame(()=>{
                frames.second = 0;
                if ((!chatAutoFollowRef.current && !chatScrollAfterCommitRef.current) || sectionRef.current !== 'agent') return;
                chatAutoFollowRef.current = true;
                chatScrollAfterCommitRef.current = false;
                chatEndRef.current?.scrollIntoView({
                    behavior: 'auto',
                    block: 'end'
                });
                window.requestAnimationFrame(()=>{
                    const lastMessage = lastChatMessageElement();
                    if (lastMessage) {
                        const overlap = lastMessage.getBoundingClientRect().bottom - (chatComposerTop() - 20);
                        if (overlap > 0) window.scrollBy({
                            top: overlap,
                            behavior: 'auto'
                        });
                    }
                    setChatNearBottom(isChatNearBottom());
                });
            });
        });
    }
    function followChatToEnd() {
        chatAutoFollowRef.current = true;
        chatScrollAfterCommitRef.current = false;
        setChatNearBottom(true);
        scheduleChatScrollToEnd();
    }
    function requestChatScrollAfterCommit() {
        chatAutoFollowRef.current = true;
        chatScrollAfterCommitRef.current = true;
        setChatNearBottom(true);
    }
    function pauseChatAutoFollow() {
        chatAutoFollowRef.current = false;
    }
    function messageViewportTop(id) {
        return document.getElementById(`message-${id}`)?.getBoundingClientRect().top ?? null;
    }
    function restoreMessageViewport(id, beforeTop) {
        if (beforeTop === null) return;
        window.requestAnimationFrame(()=>{
            const nextTop = document.getElementById(`message-${id}`)?.getBoundingClientRect().top;
            if (nextTop === undefined) return;
            const delta = nextTop - beforeTop;
            if (Math.abs(delta) > 1) window.scrollBy({
                top: delta,
                left: 0,
                behavior: 'auto'
            });
        });
    }
    function jumpToMessage(id) {
        pauseChatAutoFollow();
        setSection('agent');
        window.setTimeout(()=>document.getElementById(`message-${id}`)?.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            }), 0);
    }
    function clearConversationNavCloseTimer() {
        if (conversationNavCloseTimerRef.current) window.clearTimeout(conversationNavCloseTimerRef.current);
        conversationNavCloseTimerRef.current = 0;
    }
    function openConversationNavigator() {
        clearConversationNavCloseTimer();
        conversationNavCloseAfterClickRef.current = false;
        setConversationNavOpen(true);
    }
    function scheduleConversationNavClose(afterClick = false) {
        if (afterClick) conversationNavCloseAfterClickRef.current = true;
        clearConversationNavCloseTimer();
        conversationNavCloseTimerRef.current = window.setTimeout(()=>{
            conversationNavCloseTimerRef.current = 0;
            const navigator = conversationNavigatorRef.current;
            const pointerInside = Boolean(navigator?.matches(':hover'));
            const focusInside = Boolean(navigator && navigator.contains(document.activeElement));
            if (pointerInside || (!conversationNavCloseAfterClickRef.current && focusInside)) return;
            conversationNavCloseAfterClickRef.current = false;
            setConversationNavOpen(false);
        }, 1000);
    }
    function setThemePreference(next) {
        setTheme(next);
        document.documentElement.dataset.theme = next;
        document.documentElement.style.colorScheme = next;
        try {
            localStorage.setItem('sanmao-theme', next);
        } catch  {}
    }
    function toggleTheme() {
        setThemePreference(theme === 'light' ? 'dark' : 'light');
    }
    function setSuccessSoundPreference(enabled) {
        setSuccessSoundEnabled(enabled);
        try {
            localStorage.setItem('sanmao-success-sound', enabled ? '1' : '0');
        } catch  {}
        if (enabled) primeSuccessSound();
    }
    function setAgentWebModePreference(mode) {
        const nextMode = mode === 'always' || mode === 'off' ? mode : 'auto';
        if (nextMode !== 'off' && !agentWebSearchAvailable) return notify('请先到设置里接入搜索 API，或选择支持联网的模型');
        setAgentWebMode(nextMode);
        try {
            localStorage.setItem('sanmao-agent-web-mode', nextMode);
            localStorage.setItem('sanmao-agent-web-search', nextMode === 'off' ? '0' : '1');
        } catch  {}
    }
    function getSuccessAudioContext() {
        if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
        if (!successAudioRef.current) successAudioRef.current = new window.AudioContext();
        return successAudioRef.current;
    }
    function primeSuccessSound() {
        const context = getSuccessAudioContext();
        if (context?.state === 'suspended') void context.resume();
    }
    function playSuccessSound() {
        if (!successSoundEnabled) return;
        const context = getSuccessAudioContext();
        if (!context) return;
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(660, now);
        oscillator.frequency.exponentialRampToValueAtTime(990, now + 0.16);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.4);
    }
    function persistNavNoticeState() {
        if (!navNoticeStateReadyRef.current) return;
        try {
            localStorage.setItem(NAV_NOTICE_STORAGE_KEY, JSON.stringify(navNoticeSeenRef.current));
        } catch  {}
    }
    function initializeNavNoticeState() {
        if (navNoticeStateReadyRef.current) return;
        const now = Date.now();
        let saved = null;
        try {
            saved = JSON.parse(localStorage.getItem(NAV_NOTICE_STORAGE_KEY) || 'null');
        } catch  {}
        navNoticeSeenRef.current = {
            historySeenAt: typeof saved?.historySeenAt === 'number' && Number.isFinite(saved.historySeenAt) ? saved.historySeenAt : now,
            logErrorSeenAt: typeof saved?.logErrorSeenAt === 'number' && Number.isFinite(saved.logErrorSeenAt) ? saved.logErrorSeenAt : now
        };
        navNoticeStateReadyRef.current = true;
        persistNavNoticeState();
    }
    function latestGalleryCreatedAt(items) {
        return items.reduce((latest, item)=>Math.max(latest, item.createdAt || 0), 0);
    }
    function latestLogErrorCreatedAt(logs) {
        return logs.reduce((latest, log)=>{
            if (log.status !== 'error') return latest;
            const createdAt = Date.parse(log.createdAt);
            return Number.isFinite(createdAt) ? Math.max(latest, createdAt) : latest;
        }, 0);
    }
    function markHistoryNoticeSeen(at = latestGalleryCreatedAt(gallery)) {
        initializeNavNoticeState();
        navNoticeSeenRef.current.historySeenAt = Math.max(Date.now(), at);
        setHistoryNotice(false);
        persistNavNoticeState();
    }
    function markHistoryImageViewed(item) {
        markHistoryNoticeSeen(item?.createdAt);
    }
    function markLogErrorNoticeSeen(at = latestLogErrorCreatedAt(generationLogs)) {
        initializeNavNoticeState();
        navNoticeSeenRef.current.logErrorSeenAt = Math.max(Date.now(), at);
        setLogErrorNotice(false);
        persistNavNoticeState();
    }
    function syncHistoryNotice(items) {
        initializeNavNoticeState();
        const latest = latestGalleryCreatedAt(items);
        if (latest <= navNoticeSeenRef.current.historySeenAt) return;
        if (section === 'history') markHistoryNoticeSeen(latest);
        else setHistoryNotice(true);
    }
    function syncLogErrorNotice(logs) {
        initializeNavNoticeState();
        const latest = latestLogErrorCreatedAt(logs);
        if (latest <= navNoticeSeenRef.current.logErrorSeenAt) return;
        if (section === 'logs') markLogErrorNoticeSeen(latest);
        else setLogErrorNotice(true);
    }
    function registerHistorySuccess(items, visibleNow = false) {
        if (!items.length) return;
        initializeNavNoticeState();
        const latest = latestGalleryCreatedAt(items);
        if (visibleNow || sectionRef.current === 'history') markHistoryNoticeSeen(latest);
        else setHistoryNotice(true);
    }
    function registerGenerationFailure() {
        initializeNavNoticeState();
        if (section === 'logs') markLogErrorNoticeSeen();
        else setLogErrorNotice(true);
    }
    async function refreshGallery() {
        try {
            const items = await listGallery();
            setGallery(items);
            syncHistoryNotice(items);
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取历史失败');
        }
    }
    function getComparisonSource(item) {
        if (item.parentId) {
            const parent = gallery.find((candidate)=>candidate.id === item.parentId);
            if (parent) return {
                item: parent,
                kind: 'parent',
                label: '前一版'
            };
        }
        const firstReference = galleryReferences(item)[0];
        if (firstReference?.url) {
            return {
                item: {
                    id: `reference-${item.id}`,
                    url: firstReference.url,
                    prompt: firstReference.name || '上传参考图',
                    source: item.source,
                    createdAt: item.createdAt,
                    favorite: false
                },
                kind: 'reference',
                label: '参考图'
            };
        }
        return null;
    }
    function getGalleryParent(item) {
        return getComparisonSource(item)?.item || null;
    }
    function openViewer(item) {
        if (!item) return;
        markHistoryImageViewed(item);
        setViewerId(item.id);
    }
    function openCompare(item) {
        const source = getComparisonSource(item);
        if (!source) return;
        markHistoryImageViewed(item);
        setViewerId(null);
        setCompareState({
            item,
            source,
            parent: source.item
        });
    }
    async function refreshGenerationLogs() {
        try {
            const res = await fetch('/api/generation-logs?limit=200', {
                cache: 'no-store'
            });
            const data = await res.json();
            const logs = Array.isArray(data.logs) ? data.logs : [];
            setGenerationLogs(logs);
            syncLogErrorNotice(logs);
        } catch  {}
    }
    async function refreshVideoTasks() {
        try {
            const res = await fetch('/api/video/tasks?limit=100', { cache: 'no-store' });
            if (!res.ok) return;
            const data = await res.json().catch(()=>({}));
            setVideoTasks(Array.isArray(data.tasks) ? data.tasks : []);
        } catch  {}
    }
    async function deleteVideoTask(task) {
        try {
            const res = await fetch(`/api/video/tasks/${encodeURIComponent(task.id)}`, { method: 'DELETE' });
            const data = await res.json().catch(()=>({}));
            if (!res.ok) throw new Error(data.error || '删除视频任务失败');
            setVideoTasks((old)=>old.filter((item)=>item.id !== task.id));
            notify(task.status === 'failed' ? '失败视频任务已删除' : '视频作品已删除');
        } catch (error) {
            notify(error instanceof Error ? error.message : '删除视频任务失败');
        }
    }
    function askDeleteVideoTask(task) {
        if (task.status === 'pending' || task.status === 'running') {
            notify('视频正在生成，完成或失败后才能删除');
            return;
        }
        setConfirmState({
            title: task.status === 'failed' ? '删除这条失败任务？' : '删除这段视频？',
            text: '删除后会从本机创作记录中移除，并清理已保存的视频文件，此操作不可恢复。',
            danger: true,
            confirmText: '确认删除',
            action: async ()=>{ await deleteVideoTask(task); }
        });
    }
    async function refreshStorageMaintenance() {
        try {
            const [usageResponse, snapshotResponse] = await Promise.all([
                fetch('/api/storage/usage', { cache: 'no-store' }),
                fetch('/api/storage/snapshots', { cache: 'no-store' })
            ]);
            const usageData = await usageResponse.json().catch(()=>({}));
            const snapshotData = await snapshotResponse.json().catch(()=>({}));
            if (usageResponse.ok) setStorageUsage(usageData.usage || null);
            if (snapshotResponse.ok) setLocalSnapshots(Array.isArray(snapshotData.snapshots) ? snapshotData.snapshots : []);
        } catch {}
    }
    function formatStorageBytes(bytes) {
        const value = Number(bytes || 0);
        if (value < 1024) return `${value} B`;
        if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
        if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
        return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    async function createManualSnapshot() {
        setBackupBusy(true);
        try {
            const res = await fetch('/api/storage/snapshots', { method: 'POST' });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '创建快照失败');
            setLocalSnapshots(data.snapshots || []);
            await refreshStorageMaintenance();
            notify('本地快照已创建');
        } catch (error) { notify(error instanceof Error ? error.message : '创建快照失败'); }
        finally { setBackupBusy(false); }
    }
    async function restoreLocalSnapshotByName(name) {
        setBackupBusy(true);
        try {
            const res = await fetch('/api/storage/snapshots', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '恢复快照失败');
            notify(`快照恢复完成：${data.restoredImages || 0} 个图片文件，正在重新加载`);
            window.setTimeout(()=>window.location.reload(), 700);
        } catch (error) { notify(error instanceof Error ? error.message : '恢复快照失败'); }
        finally { setBackupBusy(false); }
    }
    useEffect(()=>{
        const pendingLogs = generationLogs.filter((log)=>!log.outputSize && log.imageUrls?.[0] && !logImageSpecs[log.id]);
        if (!pendingLogs.length) return;
        let cancelled = false;
        void Promise.all(pendingLogs.map(async (log)=>{
            try {
                const dimensions = await loadImageDimensions(log.imageUrls[0]);
                return [
                    log.id,
                    {
                        ...dimensions,
                        ratio: ratioFromDimensions(dimensions.width, dimensions.height),
                        resolution: resolutionFromDimensions(dimensions.width, dimensions.height)
                    }
                ];
            } catch  {
                return null;
            }
        })).then((entries)=>{
            if (cancelled) return;
            const next = {};
            for (const entry of entries)if (entry) next[entry[0]] = entry[1];
            if (Object.keys(next).length) setLogImageSpecs((old)=>({
                    ...old,
                    ...next
                }));
        });
        return ()=>{
            cancelled = true;
        };
    }, [
        generationLogs,
        logImageSpecs
    ]);
    function askCleanupGenerationLogs(days, deleteImages) {
        const scope = days ? `清理 90 天前的${deleteImages ? '日志和图片' : '日志'}` : `清空全部${deleteImages ? '日志和图片' : '日志'}`;
        setConfirmState({
            title: `${scope}？`,
             text: deleteImages ? '将清理符合条件的服务端日志记录，并把日志中关联的本地图片文件移入回收站；回收站会保留 7 天。' : '只会清理服务端日志记录，生成图片会保留。此操作不可恢复。',
            danger: true,
            confirmText: '确认清理',
            action: async ()=>{
                setCleanupBusy(true);
                try {
                    const res = await fetch('/api/generation-logs', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            days,
                            deleteImages
                        })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || '清理日志失败');
                    await refreshGenerationLogs();
                     notify(`已清理 ${data.removedLogs || 0} 条日志${deleteImages ? `，${data.deletedImages || 0} 个图片文件已移入回收站` : ''}`);
                } catch (error) {
                    notify(error instanceof Error ? error.message : '清理日志失败');
                } finally{
                    setCleanupBusy(false);
                }
            }
        });
    }
    async function previewCleanupGenerationLogs(days, deleteImages) {
        setCleanupBusy(true);
        try {
            const res = await fetch('/api/generation-logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days, deleteImages, dryRun: true })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '预览清理失败');
            notify(`预计清理 ${data.removedLogs || 0} 条日志${deleteImages ? `，${data.deletedImages || 0} 个图片文件将移入回收站` : ''}`);
        } catch (error) { notify(error instanceof Error ? error.message : '预览清理失败'); }
        finally { setCleanupBusy(false); }
    }
    async function exportLocalBackup() {
        setBackupBusy(true);
        try {
            const backupPassword = window.prompt('请输入备份密码（至少 12 个字符；不会保存）：');
            if (backupPassword === null) return;
            if (backupPassword.length < 12) throw new Error('备份密码至少需要 12 个字符');
            const preferenceKeys = [
                'sanmao-theme',
                'sanmao-success-sound',
                'sanmao-history-page-size',
                'sanmao-generate-settings',
                'sanmao-generate-tasks'
            ];
            const preferences = {};
            for (const key of preferenceKeys){
                const value = localStorage.getItem(key);
                if (value !== null) preferences[key] = value;
            }
            const client = {
                gallery: await normalizeGalleryForBackup(await listGallery()),
                chatSessions: await listChatSessions(),
                preferences
            };
            const res = await fetch('/api/backup/archive', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ client, backupPassword })
            });
            if (!res.ok) {
                const data = await res.json().catch(()=>({}));
                throw new Error(data.error || '生成完整备份失败');
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = objectUrl;
            anchor.download = `SANMAO-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sanmao-backup`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            window.setTimeout(()=>URL.revokeObjectURL(objectUrl), 1500);
            notify(`加密备份完成：${client.gallery.length} 张图片索引、${client.chatSessions.length} 段对话，已包含服务端图片文件`);
        } catch (error) {
            notify(error instanceof Error ? error.message : '导出备份失败');
        } finally{
            setBackupBusy(false);
        }
    }
    async function restoreClientBackup(client) {
        if (!client || !Array.isArray(client.gallery) || !Array.isArray(client.chatSessions)) throw new Error('备份缺少浏览器历史数据');
        await replaceGalleryItems(client.gallery);
        await replaceChatSessions(client.chatSessions);
        const preferenceKeys = [
            'sanmao-theme',
            'sanmao-success-sound',
            'sanmao-history-page-size',
            'sanmao-generate-settings',
            'sanmao-generate-tasks'
        ];
        for (const key of preferenceKeys) localStorage.removeItem(key);
        for (const [key, value] of Object.entries(client.preferences || {})) if (preferenceKeys.includes(key) && typeof value === 'string') localStorage.setItem(key, value);
    }
    async function prepareRestoreBackup(file) {
        try {
            if (/\.(?:sanmao-backup\.)?tar\.gz$/i.test(file.name) || /\.sanmao-backup$/i.test(file.name) || file.type === 'application/gzip' || file.type === 'application/octet-stream') {
                setConfirmState({
                    title: '恢复完整本地备份？',
                     text: '这会覆盖当前服务端配置、日志和浏览器历史，并把备份中的图片恢复到当前数据目录。新格式备份已使用独立密码加密；旧版未加密备份仍可导入。',
                    danger: true,
                    confirmText: '确认恢复',
                    action: async ()=>{
                        setBackupBusy(true);
                        try {
                            const backupPassword = window.prompt('请输入备份密码（至少 12 个字符）：') || '';
                            const res = await fetch('/api/backup/archive', {
                                method: 'PUT',
                                headers: {
                                    'Content-Type': 'application/octet-stream',
                                    'X-SANMAO-Backup-Password': backupPassword
                                },
                                body: file
                            });
                            const data = await res.json();
                            if (!res.ok) throw new Error(data.error || '恢复完整备份失败');
                            await restoreClientBackup(data.client);
                            notify(`${data.externalMasterKey ? '恢复完成，但原备份依赖 SANMAO_MASTER_KEY；请在当前环境配置相同主密钥。' : `完整备份恢复完成：${data.restoredImages || 0} 个图片文件`}，正在重新加载`);
                            window.setTimeout(()=>window.location.reload(), 700);
                        } catch (error) {
                            notify(error instanceof Error ? error.message : '恢复完整备份失败');
                        } finally {
                            setBackupBusy(false);
                        }
                    }
                });
                return;
            }
            const parsed = JSON.parse(await file.text());
            if (parsed?.format !== 'sanmao-ai-local-backup' || parsed.version !== 1 || !parsed.server || !parsed.client || !Array.isArray(parsed.client.gallery) || !Array.isArray(parsed.client.chatSessions)) throw new Error('这不是有效的 SANMAO.AI 本地备份文件');
            const keyWarning = parsed.server.externalMasterKey ? '该备份原先使用环境变量主密钥，恢复后仍需配置相同的 SANMAO_MASTER_KEY。' : '备份包含恢复接口密钥所需的本机主密钥，请妥善保存。';
            setConfirmState({
                title: '恢复本地备份？',
                text: `将覆盖当前接口配置、模型选择、生成日志、图库索引、对话和界面参数。原始图片文件不会删除。${keyWarning}`,
                danger: true,
                confirmText: '确认恢复',
                action: async ()=>{
                    setBackupBusy(true);
                    try {
                        const res = await fetch('/api/backup', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                server: parsed.server
                            })
                        });
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error || '恢复服务端数据失败');
                        await restoreClientBackup(parsed.client);
                        notify('备份恢复完成，正在重新加载');
                        window.setTimeout(()=>window.location.reload(), 700);
                    } catch (error) {
                        notify(error instanceof Error ? error.message : '恢复备份失败');
                    } finally{
                        setBackupBusy(false);
                    }
                }
            });
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取备份文件失败');
        } finally{
            if (backupInputRef.current) backupInputRef.current.value = '';
        }
    }
    async function loadLocalDirectory() {
        try {
            const handle = await loadImageDirectoryHandle();
            if (!handle) return;
            const permission = await handle.queryPermission?.({
                mode: 'readwrite'
            });
            if (permission !== 'denied') {
                setLocalDirectoryHandle(handle);
                setLocalDirectoryName(handle.name);
            }
        } catch  {}
    }
    async function chooseLocalDirectory() {
        const picker = window.showDirectoryPicker;
        if (!picker) return notify('当前浏览器不支持选择本地目录，请使用 Edge 或 Chrome');
        try {
            const handle = await picker();
            const permission = await handle.requestPermission?.({
                mode: 'readwrite'
            });
            if (permission === 'denied') throw new Error('没有获得目录写入权限');
            await saveImageDirectoryHandle(handle);
            setLocalDirectoryHandle(handle);
            setLocalDirectoryName(handle.name);
            notify(`已选择本地目录：${handle.name}`);
        } catch (error) {
            if (error?.name !== 'AbortError') notify(error instanceof Error ? error.message : '选择目录失败');
        }
    }
    async function saveImagesToLocalDirectory(images) {
        if (!localDirectoryHandle) return;
        try {
            const permission = await localDirectoryHandle.queryPermission?.({
                mode: 'readwrite'
            });
            if (permission !== 'granted' && await localDirectoryHandle.requestPermission?.({
                mode: 'readwrite'
            }) !== 'granted') throw new Error('本地目录写入权限已失效');
            for (const [index, image] of images.entries()){
                const response = image.url.startsWith('data:') ? await fetch(image.url) : await fetch(image.url);
                if (!response.ok) continue;
                const extension = response.headers.get('content-type')?.includes('jpeg') ? 'jpg' : response.headers.get('content-type')?.includes('webp') ? 'webp' : 'png';
                const fileHandle = await localDirectoryHandle.getFileHandle(`SANMAO-${Date.now()}-${index + 1}.${extension}`, {
                    create: true
                });
                const writable = await fileHandle.createWritable();
                await writable.write(await response.blob());
                await writable.close();
            }
        } catch (error) {
            notify(error instanceof Error ? error.message : '保存到本地目录失败');
        }
    }
    async function saveStoragePath(nextPath = storagePath) {
        setStorageBusy(true);
        try {
            const next = nextPath.trim();
            const res = await fetch('/api/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    imageStoragePath: next
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '保存失败');
            setStoragePath(next);
            setState(data.state);
            notify(next ? '图片存储路径已保存' : '已恢复默认存储路径');
        } catch (error) {
            notify(error instanceof Error ? error.message : '保存失败');
        } finally{
            setStorageBusy(false);
        }
    }
    async function testWebSearchApiConnection() {
        const key = webSearchApiKey.trim();
        if (webSearchAnySearchSelected && !key && !selectedWebSearchConfigured) {
            setWebSearchApiResult('尚未配置 ANYSEARCH_API_KEY，请在 .env.local 或系统环境变量中设置后再测试');
            return;
        }
        if (!key && !selectedWebSearchConfigured) return notify('请先配置当前服务商的 API Key');
        setWebSearchApiBusy(true);
        setWebSearchApiResult('');
        try {
            const res = await fetch('/api/web-search/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    provider: webSearchApiProvider,
                    apiKey: key,
                    useStored: !key
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '搜索 API 测试失败');
            const sample = Array.isArray(data.sample) ? data.sample.map((item)=>item.title).filter(Boolean).slice(0, 2).join('、') : '';
            setWebSearchApiResult(`${webSearchApiProvider === 'anysearch' ? 'AnySearch' : '百度千帆'}搜索可用，返回 ${data.resultCount || 0} 条结果${sample ? `：${sample}` : ''}`);
        } catch (error) {
            setWebSearchApiResult(error instanceof Error ? error.message : '搜索 API 测试失败');
        } finally{
            setWebSearchApiBusy(false);
        }
    }
    async function saveWebSearchApi(clear = false) {
        if (webSearchAnySearchSelected) {
            setWebSearchApiResult('AnySearch 仅通过 ANYSEARCH_API_KEY 环境变量配置，不在页面保存 Key');
            return;
        }
        if (!clear && !webSearchApiKey.trim() && !selectedWebSearchConfigured) return notify('请先填写百度千帆 API Key');
        setWebSearchApiBusy(true);
        setWebSearchApiResult('');
        try {
            const res = await fetch('/api/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    webSearchApi: {
                        provider: webSearchApiProvider,
                        apiKey: webSearchApiKey.trim(),
                        clear
                    }
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '保存搜索 API 失败');
            setState(data.state);
            setWebSearchApiKey('');
            setWebSearchApiResult(clear ? '已清除百度千帆本地配置；若设置了环境变量，仍会继续可用' : '百度千帆 API 已保存；AnySearch 环境变量存在时会优先使用 AnySearch，失败后自动切换百度千帆');
        } catch (error) {
            setWebSearchApiResult(error instanceof Error ? error.message : '保存搜索 API 失败');
        } finally{
            setWebSearchApiBusy(false);
        }
    }
    function normalizeAssistantImageSources(inputMessages) {
        return inputMessages.map((message)=>message.role === 'assistant' && message.images?.length ? {
                ...message,
                images: message.images.map((item)=>item.source === 'agent' ? item : {
                        ...item,
                        source: 'agent'
                    })
            } : message);
    }
    function messageVersionsFor(message) {
        if (message.role !== 'assistant' || !message.versions?.length) return [
            {
                id: `${message.id}-v1`,
                content: message.content,
                images: message.images,
                files: message.files,
                interrupted: message.interrupted,
                webSearch: message.webSearch,
                webSearchDecision: message.webSearchDecision,
                createdAt: 0
            }
        ];
        return message.versions;
    }
    function messageVersionIndex(message) {
        return Math.min(Math.max(0, message.activeVersion ?? messageVersionsFor(message).length - 1), messageVersionsFor(message).length - 1);
    }
    function applyMessageVersion(message, versions, activeVersion, retrying = false) {
        const version = versions[activeVersion];
        return {
            ...message,
            content: version.content,
            images: version.images,
            files: version.files,
            interrupted: version.interrupted,
            webSearch: version.webSearch ?? message.webSearch,
            webSearchDecision: version.webSearchDecision ?? message.webSearchDecision,
            versions,
            activeVersion,
            retrying
        };
    }
    function normalizeChatSession(session) {
        const messages = normalizeAssistantImageSources(session.messages).map((message)=>{
            if (message.role !== 'assistant' || !message.versions?.length) return message;
            const versions = normalizeAssistantImageSources(message.versions.map((version)=>({
                    role: 'assistant',
                    ...version
                }))).map(({ role: _role, ...version })=>version);
            const activeVersion = Math.min(Math.max(0, message.activeVersion ?? versions.length - 1), versions.length - 1);
            return applyMessageVersion({
                ...message,
                versions
            }, versions, activeVersion);
        });
        return {
            ...session,
            messages
        };
    }
    async function refreshChatSessions() {
        try {
            const sessions = (await listChatSessions()).map(normalizeChatSession);
            setChatSessions(sessions);
            if (sessions.length) {
                activeChatIdRef.current = sessions[0].id;
                setActiveChatId(sessions[0].id);
                setMessages(sessions[0].messages);
                requestChatScrollAfterCommit();
            }
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取助手历史失败');
        }
    }
    async function refreshAdmin() {
        try {
            const res = await fetch('/api/admin/session', {
                cache: 'no-store'
            });
            const data = await res.json();
            setAdminRequired(Boolean(data.required));
            setIsAdmin(Boolean(data.authenticated));
        } catch  {}
    }
    async function refreshState() {
        setLoadingState(true);
        const controller = new AbortController();
        const timeoutId = window.setTimeout(()=>controller.abort(), 12000);
        try {
            const res = await fetch('/api/state', {
                cache: 'no-store',
                signal: controller.signal
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '读取配置失败');
            setState(data);
            const selectedChat = filterModelsByActiveProviders(data.models || [], data.providers || []).find((model)=>model.id === data.settings?.agentModelId && model.enabled && model.published && model.kind === 'chat') || filterModelsByActiveProviders(data.models || [], data.providers || []).find((model)=>model.enabled && model.published && model.kind === 'chat');
            if (!data.settings?.webSearchConfigured && !selectedChat?.capabilities.includes('web-search')) {
                setAgentWebSearchEnabled(false);
                try {
                    localStorage.setItem('sanmao-agent-web-search', '0');
                } catch  {}
            }
            setStoragePath(data.settings?.imageStoragePath || '');
            if (data.settings?.webSearchProvider) setWebSearchApiProvider(data.settings.webSearchProvider);
            if (!data.providers?.length) setSection('providers');
        } catch (error) {
            const timedOut = error instanceof DOMException && error.name === 'AbortError';
            notify(timedOut ? '读取本地配置超时，请检查后台服务后重试。' : error instanceof Error ? error.message : '读取配置失败');
        } finally{
            window.clearTimeout(timeoutId);
            setLoadingState(false);
        }
    }
    async function applyReturnedState(res) {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '操作失败');
        if (data.state) setState(data.state);
        return data;
    }
    function toggleLocalUpscaleMode() {
        if (generateUpscaleMode) {
            setGenerateWorkflow('generate');
            notify('已返回普通生图模式');
            return;
        }
        if (generateRefs.length !== 1) return notify('本地超分需要恰好 1 张参考图');
        if (generateRefs.some((reference)=>reference.pending)) return notify('参考图正在准备，请稍候片刻再超分');
        if (!availableUpscaleModels.length) return notify('还没有可用的超分模型。请到模型库重新读取并启用 SeedVR2-7B。');
        const lastCall = getLastModelCall('upscale');
        const rememberedModel = lastCall?.mode === 'manual' && lastCall.modelId && availableUpscaleModels.some((model)=>model.id === lastCall.modelId) ? lastCall.modelId : 'auto';
        setGenerateUpscaleModelId(rememberedModel);
        setGeneratePromptBeforeOptimization(null);
        setGenerateWorkflow('upscale');
        notify(lastCall ? '已进入本地图片超分模式，并恢复上次设置' : '已进入本地图片超分模式');
    }
    async function addReferences(files, target) {
        try {
            const current = target === 'agent' ? agentRefs : target === 'generate' ? generateRefs : angleReference ? [
                angleReference
            ] : [];
            const room = Math.max(0, target === 'angle' ? 1 : 16 - current.length);
            const refs = await Promise.all(Array.from(files).slice(0, room).map((file)=>fileToReference(file, {
                    compressForChat: true
                })));
            if (target === 'agent') setAgentRefs((old)=>[
                    ...old,
                    ...refs
                ].slice(0, 16));
            else if (target === 'generate') setGenerateRefs((old)=>[
                    ...old,
                    ...refs
                ].slice(0, 16));
            else if (refs[0]) {
                setAngleReference(refs[0]);
                setAngleCameraSeed(null);
                setAngleCameraStartSeed(null);
                setAngleResults([]);
            }
            const noticeParts = [];
            const optimizedCount = refs.filter((reference)=>reference.optimized).length;
            if (optimizedCount) noticeParts.push(`已自动优化 ${optimizedCount} 张图片后添加`);
            if (Array.from(files).length > room) noticeParts.push(target === 'angle' ? '角度控制台只使用一张参考图' : '最多保留 16 张参考图');
            if (noticeParts.length) notify(noticeParts.join('；'));
        } catch (error) {
            notify(error instanceof Error ? error.message : '上传图片失败');
        }
    }
    async function addAgentAttachments(files) {
        const incoming = Array.from(files);
        const images = incoming.filter((file)=>file.type.startsWith('image/'));
        const documents = incoming.filter((file)=>!file.type.startsWith('image/'));
        if (images.length) await addReferences(images, 'agent');
        if (!documents.length) return;
        try {
            const room = Math.max(0, 8 - agentFiles.length);
            const parsed = await Promise.all(documents.slice(0, room).map((file)=>fileToChatFile(file)));
            const totalBytes = [
                ...agentFiles,
                ...parsed
            ].reduce((total, file)=>total + (file.size || new TextEncoder().encode(file.content).length), 0);
            if (totalBytes > 4 * 1024 * 1024) throw new Error('本轮文本文件总大小不能超过 4MB，请减少文件数量或拆分后上传');
            setAgentFiles((old)=>[
                    ...old,
                    ...parsed
                ].slice(0, 8));
            if (documents.length > room) notify('最多同时分析 8 个文本文件');
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取文本文件失败');
        }
    }
    function referenceMentionRange(value, cursor) {
        const safeCursor = Number.isFinite(cursor) ? Math.max(0, Math.min(cursor, value.length)) : value.length;
        const match = /@[^\s@]*$/.exec(value.slice(0, safeCursor));
        return match ? { start: safeCursor - match[0].length, end: safeCursor } : null;
    }
    function mentionIsOpen(value, cursor, refs) {
        return refs.length > 0 && Boolean(referenceMentionRange(value, cursor));
    }
    function insertReferenceMention(value, setter, setOpen, inputRef, index) {
        const textarea = inputRef.current;
        const cursor = textarea?.selectionStart ?? value.length;
        const range = referenceMentionRange(value, cursor);
        const start = range?.start ?? cursor;
        const mention = `@${index + 1} `;
        const next = `${value.slice(0, start)}${mention}${value.slice(cursor)}`;
        setter(next);
        setOpen(false);
        requestAnimationFrame(()=>{
            textarea?.focus();
            const nextCursor = start + mention.length;
            textarea?.setSelectionRange(nextCursor, nextCursor);
        });
    }
    async function pasteClipboardImages(target) {
        try {
            if (!navigator.clipboard?.read) throw new Error('当前浏览器不支持一键读取剪贴板，请在参考图区按 Ctrl+V');
            const clipboardItems = await navigator.clipboard.read();
            const files = [];
            for (const item of clipboardItems){
                const type = item.types.find((value)=>value.startsWith('image/'));
                if (!type) continue;
                const blob = await item.getType(type);
                files.push(new File([
                    blob
                ], `clipboard-${Date.now()}-${files.length + 1}.${type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png'}`, {
                    type
                }));
            }
            if (!files.length) throw new Error('剪贴板里没有图片');
            await addReferences(files, target);
            notify(`已从剪贴板添加 ${files.length} 张参考图`);
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取剪贴板失败');
        }
    }
    async function loginAdmin(e) {
        e.preventDefault();
        setAdminBusy(true);
        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    password: adminPassword
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '登录失败');
            setAdminPassword('');
            await refreshAdmin();
            notify('管理员已登录');
        } catch (error) {
            notify(error instanceof Error ? error.message : '登录失败');
        } finally{
            setAdminBusy(false);
        }
    }
    async function logoutAdmin() {
        await fetch('/api/admin/logout', {
            method: 'POST'
        }).catch(()=>undefined);
        await refreshAdmin();
        notify('已退出管理模式');
    }
    function openAddProvider() {
        setProviderEditId(null);
        setProviderTestResult('');
        setJimengLogin({ status: 'idle', installed: false, version: '', verificationUri: '', userCode: '', deviceCode: '', message: '', error: '', account: null, accountCheckedAt: '', accountError: '' });
        setProviderForm(emptyProviderForm());
        setProviderEditor(true);
    }
    function openEditProvider(provider) {
        setProviderEditId(provider.id);
        setProviderTestResult('');
        setJimengLogin({ status: 'idle', installed: false, version: '', verificationUri: '', userCode: '', deviceCode: '', message: '', error: '', account: null, accountCheckedAt: '', accountError: '' });
        setProviderForm({
            name: provider.name,
            type: provider.type,
            platform: provider.platform || (provider.type === 'google-gemini' ? 'google-gemini' : 'custom'),
            baseUrl: provider.baseUrl,
            apiKey: '',
            modelsPath: provider.modelsPath || '/models',
            chatPath: provider.chatPath || '/chat/completions',
            imageGenerationPath: provider.imageGenerationPath || '/images/generations',
            imageEditPath: provider.imageEditPath || '/images/edits',
            imageUpscalePath: provider.imageUpscalePath || provider.imageEditPath || '/images/edits',
            imageUpscaleStatusPath: provider.imageUpscaleStatusPath || '',
            responsesPath: provider.responsesPath || (provider.platform === 'deepseek' ? '/beta/responses' : '/responses'),
            videoTransport: provider.videoTransport || '',
            videoBaseUrl: provider.videoBaseUrl || '',
            videoTaskPath: provider.videoTaskPath || '/v1/tasks',
            videoTaskStatusPath: provider.videoTaskStatusPath || '/v1/tasks/{id}',
            videoGenerationPath: provider.videoGenerationPath || '/v1/videos',
            videoModelsPath: provider.videoModelsPath || '/v1/models',
            videoPricingPath: provider.videoPricingPath || '/v1/pricing',
            videoApiKey: '',
            jimengCliPath: provider.jimengCliPath || '',
            authHeader: provider.authHeader || 'Authorization',
            authPrefix: provider.authPrefix ?? 'Bearer '
        });
        setProviderEditor(true);
    }
    function applyProviderPreset(platform) {
        const preset = getProviderPreset(platform);
        const existingCount = state.providers.filter((provider)=>provider.platform === platform && provider.id !== providerEditId).length;
        const suggestedName = existingCount ? `${preset.short} ${existingCount + 1}` : preset.short;
        setProviderTestResult('');
        setProviderForm((old)=>({
                ...old,
                type: preset.type,
                platform,
                baseUrl: preset.needsBaseUrl ? old.platform === platform ? old.baseUrl : '' : preset.baseUrl,
                responsesPath: platform === 'deepseek' ? 'https://api.deepseek.com/beta/responses' : '/responses',
                videoTransport: preset.videoTransport || (platform === 'custom' ? old.videoTransport : ''),
                videoBaseUrl: preset.videoBaseUrl || (platform === 'custom' ? old.videoBaseUrl : ''),
                videoTaskPath: preset.videoTaskPath || old.videoTaskPath || '/v1/tasks',
                videoTaskStatusPath: preset.videoTaskStatusPath || old.videoTaskStatusPath || '/v1/tasks/{id}',
                videoGenerationPath: preset.videoGenerationPath || old.videoGenerationPath || '/v1/videos',
                videoModelsPath: preset.videoModelsPath || old.videoModelsPath || '/v1/models',
                videoPricingPath: preset.videoPricingPath || old.videoPricingPath || '/v1/pricing',
                name: providerEditId ? old.name : suggestedName
            }));
    }
    async function testProvider() {
        const localCli = providerForm.videoTransport === 'jimeng-cli';
        if ((!providerForm.baseUrl.trim() && !localCli) || (!providerForm.apiKey.trim() && !providerEditId && !localCli)) return notify('请先填写服务地址和访问密钥');
        setProviderTestBusy(true);
        setProviderTestResult('');
        try {
            const res = await fetch('/api/providers/test', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ...providerForm,
                    providerId: providerEditId
                })
            });
            const data = await res.json();
            if (!res.ok) {
                const status = Number(data.providerStatus || res.status);
                const hint = status === 401 ? '（HTTP 401：Agnes 已拒绝本次 Key；请确认国内 .cn Key 配套 https://api.agnes-ai.cn/v1，国际 .com Key 配套 https://apihub.agnes-ai.com/v1，Key 只填 sk- 开头内容，不要填 Bearer）' : '';
                throw new Error(`${data.error || '连接测试失败'}${hint}`);
            }
            const names = Array.isArray(data.sample) ? data.sample.map((m)=>m.id).slice(0, 4).join('、') : '';
            setProviderTestResult(data.message || `连接成功，发现 ${data.count} 个模型${names ? `：${names}${data.count > 4 ? '…' : ''}` : ''}`);
            return true;
        } catch (error) {
            setProviderTestResult(`连接失败：${error instanceof Error ? error.message : '请求失败'}`);
            return false;
        } finally{
            setProviderTestBusy(false);
        }
    }
    async function jimengLoginAction(action) {
        if (!providerEditId) return notify('请先保存即梦 CLI 服务配置，再开始登录');
        setJimengLogin((old) => ({ ...old, status: action === 'check' ? 'checking' : action === 'inspect' ? 'inspecting' : action === 'account' || action === 'refresh-account' ? 'accounting' : 'starting', error: '', accountError: '' }));
        try {
            const res = await fetch('/api/video/jimeng/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ providerId: providerEditId, action, deviceCode: jimengLogin.deviceCode }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '即梦 CLI 操作失败');
            setJimengLogin((old) => ({ ...old, ...data, status: data.status || (action === 'inspect' ? data.installed ? 'ready' : 'failed' : action === 'account' || action === 'refresh-account' ? data.authorized ? 'authorized' : 'idle' : old.status), error: data.error || '' }));
            if (data.error) notify(data.error);
        } catch (error) {
            const message = error instanceof Error ? error.message : '即梦 CLI 操作失败';
            setJimengLogin((old) => ({ ...old, status: 'failed', error: message }));
            notify(message);
        }
    }
    async function saveProvider(e) {
        e.preventDefault();
        const localCli = providerForm.videoTransport === 'jimeng-cli';
        if (!providerForm.baseUrl.trim() && !localCli) return notify('请填写服务商提供的 API 地址');
        if (!providerEditId && !providerForm.apiKey.trim() && !localCli) return notify('请填写访问密钥');
        setProviderBusy(true);
        try {
            const connected = await testProvider();
            if (!connected) return;
            const editId = providerEditId;
            const res = await fetch(editId ? `/api/providers/${editId}` : '/api/providers', {
                method: editId ? 'PATCH' : 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(providerForm)
            });
            const data = await applyReturnedState(res);
            const id = editId || data.id;
            setProviderEditor(false);
            setProviderEditId(null);
            setProviderTestResult('');
            notify(editId ? '连接已更新，正在重新读取模型' : '连接已保存，正在读取模型');
            await syncProvider(id);
        } catch (error) {
            notify(error instanceof Error ? error.message : '保存失败');
        } finally{
            setProviderBusy(false);
        }
    }
    async function syncProvider(id) {
        setSyncingId(id);
        try {
            const previousIds = new Set(state.models.filter((model)=>model.providerId === id).map((model)=>model.rawId || model.id));
            const res = await fetch(`/api/providers/${id}/sync`, {
                method: 'POST'
            });
            const data = await applyReturnedState(res);
            const syncedModels = data.state?.models?.filter((model)=>model.providerId === id) || [];
            const newCount = syncedModels.filter((model)=>!previousIds.has(model.rawId || model.id)).length;
            const enabledCount = syncedModels.filter((model)=>model.enabled && model.published).length;
            notify(`读取完成：${data.count} 个模型${newCount ? `，新增 ${newCount} 个` : ''}，已启用 ${enabledCount} 个。`);
            setModelProviderFilter(id);
            setModelSearch('');
            setExpandedModelProviders(new Set([id]));
            setSection('models');
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取模型失败');
            await refreshState();
        } finally{
            setSyncingId(null);
        }
    }
    function toggleModelProviderGroup(providerId) {
        setExpandedModelProviders((current)=>{
            const next = new Set(current);
            if (next.has(providerId)) next.delete(providerId);
            else next.add(providerId);
            return next;
        });
    }
    async function toggleProviderModelLibrary(provider) {
        try {
            const res = await fetch(`/api/providers/${provider.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    modelLibraryEnabled: !isProviderModelLibraryEnabled(provider)
                })
            });
            await applyReturnedState(res);
            notify(isProviderModelLibraryEnabled(provider) ? '已从模型库隐藏该服务商' : '已将该服务商加入模型库');
        } catch (error) {
            notify(error instanceof Error ? error.message : '更新服务商模型库状态失败');
        }
    }
    function askDeleteProvider(id) {
        setConfirmState({
            title: '删除接口服务？',
            text: '该服务下同步的模型也会一起移除。此操作不会影响本地创作记录。',
            danger: true,
            confirmText: '删除服务',
            action: async ()=>{
                const res = await fetch(`/api/providers/${id}`, {
                    method: 'DELETE'
                });
                await applyReturnedState(res);
                notify('接口服务已删除');
            }
        });
    }
    async function patchModel(model, patch) {
        try {
            const res = await fetch(`/api/models/${model.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(patch)
            });
            return await applyReturnedState(res);
        } catch (error) {
            notify(error instanceof Error ? error.message : '更新模型失败');
            return null;
        }
    }
    async function setModelKind(model, kind) {
        if (model.kind === kind) return;
        if (modelKindBusyRef.current.has(model.id)) return;
        modelKindBusyRef.current.add(model.id);
        setModelKindBusy(new Set(modelKindBusyRef.current));
        try {
            const data = await patchModel(model, {
                kind
            });
            if (data?.state) {
                const saved = data.state.models?.find((item) => item.id === model.id);
                notify(`已归类为${kindLabel(saved?.kind || kind)}`);
            }
        } finally {
            modelKindBusyRef.current.delete(model.id);
            setModelKindBusy(new Set(modelKindBusyRef.current));
        }
    }
    async function patchSettings(patch) {
        try {
            const res = await fetch('/api/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(patch)
            });
            await applyReturnedState(res);
        } catch (error) {
            notify(error instanceof Error ? error.message : '保存默认模型失败');
        }
    }
    async function toggleModelUse(model) {
        if (model.kind === 'unknown') return notify('先把这个模型标记为“对话、图片或视频模型”');
        const nextUse = !(model.enabled && model.published);
        const data = await patchModel(model, {
            enabled: nextUse,
            published: nextUse
        });
        if (!data?.state || !nextUse) return;
        const nextState = data.state;
        if (model.kind === 'chat' && !nextState.settings.agentModelId) await patchSettings({
            agentModelId: model.id
        });
        if (model.kind === 'image' && model.capabilities.includes('generate') && !nextState.settings.defaultImageModelId) await patchSettings({
            defaultImageModelId: model.id
        });
        if (model.kind === 'video' && !nextState.settings.defaultVideoModelId) await patchSettings({
            defaultVideoModelId: model.id
        });
    }
    async function persistReferenceImages(references) {
        const source = (references || []).map((reference, index)=>({
            reference,
            index,
            dataUrl: typeof reference?.dataUrl === 'string' ? reference.dataUrl : typeof reference?.url === 'string' ? reference.url : ''
        })).filter((entry)=>entry.dataUrl && (entry.dataUrl.startsWith('data:image/') || /^https?:\/\//i.test(entry.dataUrl) || entry.dataUrl.startsWith('/api/storage/file?'))).slice(0, 16);
        if (!source.length) return [];
        try {
            const response = await fetch('/api/storage/images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    images: source.map((entry)=>({ url: entry.dataUrl }))
                })
            });
            const data = await response.json().catch(()=>({}));
            if (response.ok && Array.isArray(data.images)) return source.map((reference, index)=>({
                id: reference.reference?.id,
                name: reference.reference?.name || `参考图 ${reference.index + 1}`,
                url: typeof data.images[index]?.url === 'string' ? data.images[index].url : reference.dataUrl
            }));
        } catch  {}
        return source.map((reference, index)=>({
            id: entry.reference?.id,
            name: entry.reference?.name || `参考图 ${entry.index + 1}`,
            url: entry.dataUrl
        }));
    }
    async function persistHistoryImage(image) {
        if (!image?.url || (!image.url.startsWith('data:image/') && !/^https?:\/\//i.test(image.url))) return image;
        try {
            const response = await fetch('/api/storage/images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    images: [
                        image
                    ]
                })
            });
            const data = await response.json().catch(()=>({}));
            const saved = data.images?.[0];
            return response.ok && typeof saved?.url === 'string' ? {
                ...image,
                ...saved
            } : image;
        } catch {
            return image;
        }
    }
    async function normalizeGalleryForBackup(items) {
        const normalized = [];
        for (const item of items) {
            const next = await persistHistoryImage(item);
            const references = Array.isArray(item.references) ? await Promise.all(item.references.map(async (reference)=>{
                const stored = await persistHistoryImage({ url: reference.url });
                return {
                    ...reference,
                    url: stored.url
                };
            })) : [];
            const compareReference = item.compareReferenceUrl ? await persistHistoryImage({ url: item.compareReferenceUrl }) : null;
            normalized.push({
                ...item,
                url: next.url,
                references: references.length ? references : item.references,
                compareReferenceUrl: references[0]?.url || compareReference?.url || item.compareReferenceUrl,
                compareReferenceName: references[0]?.name || item.compareReferenceName
            });
        }
        return normalized;
    }
    async function recordImages(images, meta) {
        const storedImages = await Promise.all(images.map(async (image)=>{
            return persistHistoryImage(image);
        }));
        const now = Date.now();
        const items = storedImages.map((image, index)=>({
                id: uid('img'),
                url: image.url,
                prompt: meta.prompt,
                revisedPrompt: image.revisedPrompt,
                modelId: meta.modelId,
                modelName: meta.modelName,
                providerName: meta.providerName,
                aspectRatio: meta.aspectRatio,
                outputSize: meta.outputSize,
                outputFormat: meta.outputFormat,
                generationMs: meta.generationMs,
                source: meta.source,
                createdAt: now + index,
                favorite: false,
                parentId: meta.parentId,
                sourceImageId: meta.sourceImageId,
                upscaleProvider: meta.upscaleProvider,
                upscaleModel: meta.upscaleModel,
                upscaleScale: meta.upscaleScale,
                upscaleTaskId: meta.upscaleTaskId,
                references: meta.references?.length ? meta.references : meta.compareReference ? [meta.compareReference] : undefined,
                compareReferenceUrl: meta.references?.[0]?.url || meta.compareReference?.url,
                compareReferenceName: meta.references?.[0]?.name || meta.compareReference?.name,
                angle: meta.angle
            }));
        await saveGalleryItems(items);
        setGallery((old)=>[
                ...items,
                ...old
            ]);
        registerHistorySuccess(items, sectionRef.current === 'generate' || (meta.source === 'agent' && sectionRef.current === 'agent'));
        void saveImagesToLocalDirectory(images);
        return items;
    }
    function patchGenerateTask(id, patch) {
        setGenerateTasks((old)=>old.map((task)=>task.id === id ? {
                    ...task,
                    ...patch
                } : task));
    }
    function appendGenerateTaskItems(id, items) {
        if (!items.length) return;
        setGenerateTasks((old)=>old.map((task)=>task.id === id ? {
                    ...task,
                    items: [
                        ...task.items,
                        ...items
                    ],
                    itemIds: [
                        ...task.itemIds || task.items.map((item)=>item.id),
                        ...items.map((item)=>item.id)
                    ]
                } : task));
    }
    function restoreGenerateTask(task) {
        const request = task.request;
        if (!request) return notify('这轮任务没有保存完整参数，无法恢复');
        if (request.angle) {
            setAngleReference(request.references?.[0] || null);
            setAngleCameraSeed(request.angle);
            setAngleCameraStartSeed(request.angleStart || null);
            setAngleResults(task.items || []);
            setSection('angle');
            notify(request.referencesOmitted ? '角度参数已恢复，但参考图较大未能随任务保存，请重新添加参考图' : '已恢复这一轮的角度参数');
            return;
        }
        setGeneratePrompt(task.prompt === 'Upscale this image' ? '' : task.prompt);
        setGeneratePromptBeforeOptimization(null);
        const restoringUpscale = task.mode === 'upscale';
        if (restoringUpscale) {
            setGenerateWorkflow('upscale');
            setGenerateUpscaleModelId(request.modelId && availableUpscaleModels.some((model)=>model.id === request.modelId) ? request.modelId : 'auto');
        } else {
            setGenerateWorkflow('generate');
            setGenerateModelId(request.modelId && availableGenerationModels.some((model)=>model.id === request.modelId) ? request.modelId : 'auto');
        }
        setRatio(request.ratio || '1:1');
        setCustomRatioWidth(Math.max(1, Math.round(request.customRatioWidth || 16)));
        setCustomRatioHeight(Math.max(1, Math.round(request.customRatioHeight || 9)));
        setSizeMode(request.sizeMode || 'system');
        setSizeTier(request.sizeTier || '1k');
        setCount(Math.max(1, Math.min(8, request.count || task.expectedCount || 1)));
        setQuality(request.quality || '自动');
        setCustomWidth(Math.max(1, Math.round(request.customWidth || 1024)));
        setCustomHeight(Math.max(1, Math.round(request.customHeight || 1024)));
        setOutputFormat(request.outputFormat || 'png');
        setBackgroundMode(request.backgroundMode || 'auto');
        setGenerateUpscaleScale(request.upscaleScale || 2);
        setGenerateUpscaleTarget(request.upscaleTarget || 'auto');
        setGenerateUpscaleSeed(Number.isFinite(request.upscaleSeed) ? request.upscaleSeed : 42);
        setGenerateUpscaleColorCorrection(request.upscaleColorCorrection || 'wavelet');
        setGenerateUpscaleAlgorithm(request.upscaleAlgorithm || 'lanczos');
        if (request.upscaleOutputFormat === 'png' || request.upscaleOutputFormat === 'jpg' || request.upscaleOutputFormat === 'bmp') setGenerateUpscaleOutputFormat(request.upscaleOutputFormat);
        if (typeof request.upscaleOutputQuality === 'number' && request.upscaleOutputQuality >= 30 && request.upscaleOutputQuality <= 100) setGenerateUpscaleOutputQuality(Math.round(request.upscaleOutputQuality));
        setGenerateRefs(request.references || []);
        setGenerateMask(request.mask || null);
        setSection('generate');
        notify(request.referencesOmitted ? '参数已恢复，但参考图较大未能随任务保存，请重新添加参考图' : '已恢复这一轮的生图参数');
    }
    async function retryGenerateTask(task) {
        const request = task.request;
        if (!request) return notify('这轮任务没有保存完整参数，无法重试');
        if (request.referencesOmitted) return notify('这轮任务的参考图过大未保存，请先点击“恢复参数”并重新添加参考图');
        const remainingCount = task.mode === 'generate' || task.mode === 'edit' ? Math.max(1, task.expectedCount - task.items.length) : 1;
        const retryRequest = {
            ...request,
            count: remainingCount,
            references: [
                ...request.references
            ],
            mask: request.mask ? {
                ...request.mask
            } : null
        };
        await submitGenerate(undefined, {
            prompt: task.prompt,
            references: retryRequest.references,
            modelId: retryRequest.modelId,
            angle: retryRequest.angle,
            angleStart: retryRequest.angleStart,
            mode: task.mode,
            request: retryRequest
        });
    }
    async function submitGenerate(e, overrides) {
        e?.preventDefault();
        const savedRequest = overrides?.request;
        const isAngleGeneration = Boolean(savedRequest?.angle || overrides?.angle);
        const submittedAngleOutput = savedRequest?.angleOutput || overrides?.angleOutput;
        const submittedPrompt = overrides?.prompt.trim() || generatePrompt.trim();
        const submittedRefs = savedRequest ? [
            ...savedRequest.references
        ] : overrides ? [
            ...overrides.references
        ] : [
            ...generateRefs
        ];
        const submittedUpscaleMode = !isAngleGeneration && (savedRequest ? overrides?.mode === 'upscale' : generateUpscaleMode);
        const submittedModelId = savedRequest?.modelId || overrides?.modelId || (submittedUpscaleMode ? generateUpscaleModelId : generateModelId);
        const submittedModel = submittedModelId !== 'auto' ? (submittedUpscaleMode ? availableUpscaleModels.find((model)=>model.id === submittedModelId) : activeProviderModels.find((model)=>model.id === submittedModelId)) : submittedUpscaleMode ? selectedUpscaleModel : defaultImageModel;
        const submittedSizeMode = savedRequest?.sizeMode || sizeMode;
        const submittedCustomWidth = savedRequest?.customWidth || customWidth;
        const submittedCustomHeight = savedRequest?.customHeight || customHeight;
        if (submittedRefs.some((reference)=>reference.pending)) return notify('参考图正在准备，请稍候片刻再提交');
        if (!submittedUpscaleMode && !submittedPrompt) return notify('先描述你想生成什么');
        if (!submittedUpscaleMode && !isAngleGeneration && submittedSizeMode === 'custom' && (submittedCustomWidth < 1 || submittedCustomHeight < 1)) return notify('请输入有效的自定义宽高');
        const hasAvailableModel = isAngleGeneration ? availableGenerationModels.length > 0 : submittedUpscaleMode ? availableUpscaleModels.length > 0 : availableGenerationModels.length > 0;
        if (!hasAvailableModel) return notify(submittedUpscaleMode ? '还没有可用的超分模型，请先到模型库启用模型' : '还没有可用图片模型，请先到模型库启用模型');
        const taskId = uid('generate-task');
        const taskPrompt = submittedPrompt || 'Upscale this image';
        const taskRefs = submittedRefs;
        const taskReferenceBytes = taskRefs.reduce((total, reference)=>total + reference.dataUrl.length, 0) + (isAngleGeneration ? 0 : savedRequest ? savedRequest.mask?.dataUrl.length || 0 : generateMask?.dataUrl.length || 0);
        if (taskReferenceBytes > 7000000) return notify('参考图和蒙版总大小过大，已停止提交；请减少图片数量或重新上传后再试');
        if (submittedUpscaleMode && taskRefs.length !== 1) return notify('本地超分需要恰好 1 张参考图');
        const taskMode = savedRequest ? overrides?.mode || (submittedUpscaleMode ? 'upscale' : taskRefs.length ? 'edit' : 'generate') : submittedUpscaleMode ? 'upscale' : taskRefs.length ? 'edit' : 'generate';
        const taskCount = savedRequest ? Math.max(1, Math.min(8, savedRequest.count || 1)) : submittedUpscaleMode || isAngleGeneration ? 1 : count;
        const taskModelId = submittedModelId;
        const taskModel = submittedModel;
        const requestedRatio = isAngleGeneration ? submittedAngleOutput?.aspectRatio || '自动' : savedRequest?.ratio || ratio;
        const autoReferenceSize = requestedRatio === '自动' && taskRefs.length >= 1 && (isAngleGeneration || taskRefs.length === 1) ? (isAngleGeneration ? null : generateAutoReferenceSize) || await loadImageDimensions(taskRefs[0].dataUrl).catch(()=>null) : null;
        const taskRatio = requestedRatio === '自动' && autoReferenceSize ? exactRatioFromDimensions(autoReferenceSize.width, autoReferenceSize.height) : requestedRatio;
        const taskCustomRatioWidth = savedRequest?.customRatioWidth || customRatioWidth;
        const taskCustomRatioHeight = savedRequest?.customRatioHeight || customRatioHeight;
        const taskSizeMode = isAngleGeneration ? 'custom' : savedRequest?.sizeMode || sizeMode;
        const taskSizeTier = isAngleGeneration ? '1k' : savedRequest?.sizeTier || sizeTier;
        const taskCustomWidth = isAngleGeneration ? submittedAngleOutput?.width || 1280 : savedRequest?.customWidth || customWidth;
        const taskCustomHeight = isAngleGeneration ? submittedAngleOutput?.height || 1280 : savedRequest?.customHeight || customHeight;
        const taskQuality = isAngleGeneration ? '自动' : savedRequest?.quality || quality;
        const taskOutputFormat = isAngleGeneration ? 'png' : savedRequest?.outputFormat || outputFormat;
        const taskBackgroundMode = isAngleGeneration ? 'auto' : savedRequest?.backgroundMode || backgroundMode;
        const taskMask = savedRequest ? savedRequest.mask?.dataUrl : generateMask?.dataUrl;
        const taskUpscaleScale = savedRequest?.upscaleScale || generateUpscaleScale;
        const taskUpscaleTarget = savedRequest?.upscaleTarget || generateUpscaleTarget;
        const taskUpscaleSeed = savedRequest?.upscaleSeed ?? generateUpscaleSeed;
        const taskUpscaleColorCorrection = savedRequest?.upscaleColorCorrection || generateUpscaleColorCorrection;
        const taskUpscaleAlgorithm = savedRequest?.upscaleAlgorithm || generateUpscaleAlgorithm;
        const taskUpscaleOutputFormat = savedRequest?.upscaleOutputFormat || generateUpscaleOutputFormat;
        const taskUpscaleOutputQuality = savedRequest?.upscaleOutputQuality || generateUpscaleOutputQuality;
        const taskRequest = savedRequest ? {
            ...savedRequest,
            modelId: taskModelId,
            ratio: taskRatio,
            customRatioWidth: taskCustomRatioWidth,
            customRatioHeight: taskCustomRatioHeight,
            sizeMode: taskSizeMode,
            sizeTier: taskSizeTier,
            count: taskCount,
            quality: taskQuality,
            customWidth: taskCustomWidth,
            customHeight: taskCustomHeight,
            outputFormat: taskOutputFormat,
            backgroundMode: taskBackgroundMode,
            upscaleScale: taskUpscaleScale,
            upscaleTarget: taskUpscaleTarget,
            upscaleSeed: taskUpscaleSeed,
            upscaleColorCorrection: taskUpscaleColorCorrection,
            upscaleAlgorithm: taskUpscaleAlgorithm,
            upscaleOutputFormat: taskUpscaleOutputFormat,
            upscaleOutputQuality: taskUpscaleOutputQuality,
            references: taskRefs,
            sourceImageId: submittedUpscaleMode ? taskRefs[0]?.id : undefined,
            mask: isAngleGeneration ? null : savedRequest.mask ? {
                ...savedRequest.mask
            } : null,
            angle: savedRequest.angle,
            angleStart: savedRequest.angleStart,
            angleNote: savedRequest.angleNote,
            angleGuide: savedRequest.angleGuide,
            angleOutput: savedRequest.angleOutput
        } : {
            modelId: taskModelId,
            ratio: taskRatio,
            customRatioWidth: taskCustomRatioWidth,
            customRatioHeight: taskCustomRatioHeight,
            sizeMode: taskSizeMode,
            sizeTier: taskSizeTier,
            count: taskCount,
            quality: taskQuality,
            customWidth: taskCustomWidth,
            customHeight: taskCustomHeight,
            outputFormat: taskOutputFormat,
            backgroundMode: taskBackgroundMode,
            upscaleScale: taskUpscaleScale,
            upscaleTarget: taskUpscaleTarget,
            upscaleSeed: taskUpscaleSeed,
            upscaleColorCorrection: taskUpscaleColorCorrection,
            upscaleAlgorithm: taskUpscaleAlgorithm,
            upscaleOutputFormat: taskUpscaleOutputFormat,
            upscaleOutputQuality: taskUpscaleOutputQuality,
            references: taskRefs,
            sourceImageId: submittedUpscaleMode ? taskRefs[0]?.id : undefined,
            mask: isAngleGeneration ? null : generateMask ? {
                ...generateMask
            } : null,
            angle: overrides?.angle,
            angleStart: overrides?.angleStart,
            angleNote: overrides?.angleNote,
            angleGuide: overrides?.angleGuide,
            angleOutput: overrides?.angleOutput
        };
        const preferenceContext = taskMode === 'upscale' ? 'upscale' : taskRefs.length ? 'edit' : 'generate';
        const manualImageModel = taskModelId !== 'auto' ? activeProviderModels.find((model)=>model.id === taskModelId) : undefined;
        const recordImagePreference = (actualModelId)=>{
            if (isAngleGeneration) return;
            const actualModel = actualModelId ? state.models.find((model)=>model.id === actualModelId) : undefined;
            const usedModel = manualImageModel || actualModel;
            recordModelCall({
                context: preferenceContext,
                mode: manualImageModel ? 'manual' : 'auto',
                providerId: usedModel?.providerId,
                modelId: usedModel?.id,
                params: {
                    ratio: taskRatio,
                    customRatioWidth: taskCustomRatioWidth,
                    customRatioHeight: taskCustomRatioHeight,
                    sizeMode: taskSizeMode,
                    sizeTier: taskSizeTier,
                    count: taskCount,
                    quality: taskQuality,
                    customWidth: taskCustomWidth,
                    customHeight: taskCustomHeight,
                    outputFormat: taskOutputFormat,
                    backgroundMode: taskBackgroundMode,
                    upscaleScale: taskUpscaleScale,
                    upscaleTarget: taskUpscaleTarget,
                    upscaleSeed: taskUpscaleSeed,
                    upscaleColorCorrection: taskUpscaleColorCorrection,
                    upscaleAlgorithm: taskUpscaleAlgorithm
                }
            });
        };
        const requestStartedAt = performance.now();
        primeSuccessSound();
        setGenerateTasks((old)=>[
                {
                    id: taskId,
                    status: 'pending',
                    mode: taskMode,
                    prompt: taskPrompt,
                    expectedCount: taskCount,
                    startedAt: Date.now(),
                    info: `${taskModel?.displayName || '自动模型'} · ${taskMode === 'upscale' ? '图片超分' : taskMode === 'edit' ? '参考图生成' : '文本生成'}`,
                    items: [],
                    itemIds: [],
                    request: taskRequest
                },
                ...old
            ]);
        setGenerateClock(Date.now());
        setLastGenerateInfo('');
        try {
            const referenceRecords = await persistReferenceImages(taskRefs);
            if (taskMode === 'upscale') {
                if (!taskRefs.length) throw new Error('SeedVR2-7B 是图片超分模型，请先添加一张参考图，再点击生成。');
                const sourceSize = await loadImageDimensions(taskRefs[0].dataUrl);
                 const targetSize = upscalePreviewDimensions(sourceSize, taskUpscaleScale, taskModel, taskUpscaleTarget);
                 const cloudUpscale = isCloudUpscaleModel(taskModel);
                 const taskCloudOutputFormat = cloudUpscale && taskModel?.outputFormats?.includes(taskUpscaleOutputFormat) ? taskUpscaleOutputFormat : undefined;
                const upscaleRes = await fetch('/api/upscale', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        taskId,
                        prompt: taskPrompt,
                        model: taskModelId === 'auto' ? taskModel?.id : taskModelId,
                        reference: taskRefs[0].dataUrl,
                        sourceImageId: taskRefs[0].id,
                         referenceImages: referenceRecords,
                         scale: taskUpscaleScale,
                         ...(cloudUpscale ? {
                            ...(taskCloudOutputFormat ? { outputFormat: taskCloudOutputFormat } : {}),
                            ...(taskCloudOutputFormat === 'jpg' ? { outputQuality: taskUpscaleOutputQuality } : {})
                        } : {
                            size: `${targetSize.width}x${targetSize.height}`,
                            seed: taskUpscaleSeed,
                            colorCorrection: taskUpscaleColorCorrection,
                            resizeMethod: taskUpscaleAlgorithm
                        })
                    })
                });
                let upscaleData = await upscaleRes.json();
                if (!upscaleRes.ok) throw new Error(upscaleData.error || '图片超分失败');
                if (upscaleData.taskId) patchGenerateTask(taskId, { upscaleTaskId: upscaleData.taskId, info: `${upscaleData.model?.name || '高清放大'} · 后台处理中` });
                if (upscaleData.taskId && (upscaleData.status === 'queued' || upscaleData.status === 'processing')) upscaleData = await waitForUpscaleTask(upscaleData.taskId, upscaleData);
                recordImagePreference(upscaleData.model?.id);
                const durationMs = Math.round(performance.now() - requestStartedAt);
                const items = await recordImages(upscaleData.images || [], {
                    prompt: taskPrompt,
                    modelId: upscaleData.model?.id,
                    modelName: upscaleData.model?.name,
                    providerName: upscaleData.model?.provider,
                    aspectRatio: '自动',
                    outputSize: `${taskUpscaleScale}× 超分`,
                    outputFormat: taskCloudOutputFormat ? taskCloudOutputFormat === 'jpg' ? 'jpeg' : taskCloudOutputFormat : 'png',
                    generationMs: durationMs,
                    source: 'upscale',
                    parentId: upscaleData.sourceImageId || taskRefs[0].id,
                    sourceImageId: upscaleData.sourceImageId || taskRefs[0].id,
                    upscaleProvider: upscaleData.model?.provider,
                    upscaleModel: upscaleData.model?.id,
                    upscaleScale: taskUpscaleScale,
                    upscaleOutputFormat: taskCloudOutputFormat,
                    upscaleOutputQuality: taskCloudOutputFormat === 'jpg' ? taskUpscaleOutputQuality : undefined,
                    upscaleTaskId: upscaleData.taskId,
                    references: referenceRecords
                });
                const info = `${upscaleData.model?.name || '超分模型'} · ${taskUpscaleScale}× · 图片超分 · ${(durationMs / 1000).toFixed(1)}s · ${items.length} 张`;
                setResultItems((old)=>[
                        ...items,
                        ...old
                    ]);
                patchGenerateTask(taskId, {
                    status: 'success',
                    completedAt: Date.now(),
                    info,
                    items
                });
                if (items.length) playSuccessSound();
                void refreshGenerationLogs();
                setLastGenerateInfo(info);
                return;
            }
            const requestRatio = taskSizeMode === 'custom' ? '自定义' : taskRatio;
            const presetSize = presetDimensions(taskRatio, taskSizeTier, customRatioWidth, customRatioHeight);
            const requestWidth = taskSizeMode === 'system' && taskRatio !== '自动' ? presetSize.width : taskSizeMode === 'custom' ? taskCustomWidth : 0;
            const requestHeight = taskSizeMode === 'system' && taskRatio !== '自动' ? presetSize.height : taskSizeMode === 'custom' ? taskCustomHeight : 0;
            const outputSize = requestWidth && requestHeight ? `${requestWidth}×${requestHeight}` : `${taskSizeTier.toUpperCase()} · 自动比例`;
            if (taskCount > 1) {
                let completedCount = 0;
                let failedCount = 0;
                let transparentFailures = 0;
                let resolvedModelName = taskModel?.displayName || '图片模型';
                const failures = [];
                const runs = Array.from({
                    length: taskCount
                }, (_, index)=>(async ()=>{
                        const childTaskId = `${taskId}-${index + 1}`;
                        const childStartedAt = performance.now();
                        try {
                            const childRes = await fetch('/api/generate', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    taskId: childTaskId,
                                    prompt: taskPrompt,
                                    model: taskModelId,
                                    aspectRatio: requestRatio,
                                    resolution: taskSizeTier.toUpperCase(),
                                    count: 1,
                                    width: requestWidth,
                                    height: requestHeight,
                                    quality: taskQuality,
                                    fidelity: isAngleGeneration ? 'low' : 'high',
                                    outputFormat: taskBackgroundMode === 'local-transparent' ? 'png' : taskOutputFormat,
                                    background: taskBackgroundMode === 'api-transparent' ? 'transparent' : taskBackgroundMode === 'opaque' ? 'opaque' : undefined,
                                    mask: taskMask,
                                    references: taskRefs.map((r)=>r.dataUrl),
                                    referenceImages: referenceRecords,
                                    camera: isAngleGeneration ? taskRequest.angle : undefined,
                                    cameraStart: isAngleGeneration ? taskRequest.angleStart : undefined,
                                    angleNote: isAngleGeneration ? taskRequest.angleNote : undefined,
                                    angleGuide: isAngleGeneration ? taskRequest.angleGuide : undefined
                                })
                            });
                            const childData = await childRes.json();
                            if (!childRes.ok) throw new Error(childData.error || `第 ${index + 1} 张生成失败`);
                            recordImagePreference(childData.model?.id);
                            let returnedImages = childData.images || [];
                            if (!returnedImages.length) throw new Error(`第 ${index + 1} 张没有返回图片`);
                            if (taskBackgroundMode === 'local-transparent') {
                                let failuresForImage = 0;
                                returnedImages = await Promise.all(returnedImages.map(async (image)=>{
                                    try {
                                        return await makeWhiteBackgroundTransparent(image);
                                    } catch  {
                                        failuresForImage++;
                                        return image;
                                    }
                                }));
                                transparentFailures += failuresForImage;
                            }
                            const durationMs = Math.round(performance.now() - childStartedAt);
                            const actualOutputFormat = taskBackgroundMode === 'local-transparent' ? 'png' : taskOutputFormat;
                            const items = await recordImages(returnedImages, {
                                prompt: taskPrompt,
                                modelId: childData.model?.id,
                                modelName: childData.model?.name,
                                providerName: childData.model?.provider,
                                aspectRatio: requestRatio,
                                outputSize,
                                outputFormat: actualOutputFormat,
                                generationMs: durationMs,
                                source: taskRefs.length ? 'edit' : 'generate',
                                references: referenceRecords,
                                angle: taskRequest.angle
                            });
                            completedCount += items.length;
                            resolvedModelName = childData.model?.name || resolvedModelName;
                            appendGenerateTaskItems(taskId, items);
                            setResultItems((old)=>[
                                    ...items,
                                    ...old
                                ]);
                            patchGenerateTask(taskId, {
                                info: `${resolvedModelName} · 已返回 ${completedCount}/${taskCount} 张`
                            });
                            if (items.length) playSuccessSound();
                            void refreshGenerationLogs();
                        } catch (error) {
                            failedCount += 1;
                            failures.push(`第 ${index + 1} 张：${error instanceof Error ? error.message : '生成失败'}`);
                            registerGenerationFailure();
                            void refreshGenerationLogs();
                        }
                    })());
                void refreshGenerationLogs();
                await Promise.all(runs);
                const durationMs = Math.round(performance.now() - requestStartedAt);
                const info = `${resolvedModelName} · ${outputSize || '自动分辨率'} · ${taskRefs.length ? '参考图生成' : '文本生成'} · ${(durationMs / 1000).toFixed(1)}s · ${completedCount}/${taskCount} 张已返回${failedCount ? `，${failedCount} 张失败` : ''}`;
                const errorMessage = failures.length ? failures.join('；') : undefined;
                patchGenerateTask(taskId, {
                    status: failedCount ? 'error' : 'success',
                    completedAt: Date.now(),
                    info,
                    error: errorMessage
                });
                if (transparentFailures) notify(`${transparentFailures} 张图片受到跨域限制，已保留原背景；可改用“API 透明”`);
                if (failedCount) notify(`本轮已返回 ${completedCount} 张，${failedCount} 张失败`);
                setLastGenerateInfo(info);
                void refreshGenerationLogs();
                return;
            }
            const res = await fetch('/api/generate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    taskId,
                    prompt: taskPrompt,
                    model: taskModelId,
                    aspectRatio: requestRatio,
                    resolution: taskSizeTier.toUpperCase(),
                    count: taskCount,
                    width: requestWidth,
                    height: requestHeight,
                    quality: taskQuality,
                    fidelity: isAngleGeneration ? 'low' : 'high',
                    outputFormat: taskBackgroundMode === 'local-transparent' ? 'png' : taskOutputFormat,
                    background: taskBackgroundMode === 'api-transparent' ? 'transparent' : taskBackgroundMode === 'opaque' ? 'opaque' : undefined,
                    mask: taskMask,
                    references: taskRefs.map((r)=>r.dataUrl),
                    referenceImages: referenceRecords,
                    camera: isAngleGeneration ? taskRequest.angle : undefined,
                    cameraStart: isAngleGeneration ? taskRequest.angleStart : undefined,
                    angleNote: isAngleGeneration ? taskRequest.angleNote : undefined,
                    angleGuide: isAngleGeneration ? taskRequest.angleGuide : undefined
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '生成失败');
            recordImagePreference(data.model?.id);
            const durationMs = Math.round(performance.now() - requestStartedAt);
            let returnedImages = data.images || [];
            if (taskBackgroundMode === 'local-transparent') {
                let failures = 0;
                returnedImages = await Promise.all(returnedImages.map(async (image)=>{
                    try {
                        return await makeWhiteBackgroundTransparent(image);
                    } catch  {
                        failures++;
                        return image;
                    }
                }));
                if (failures) notify(`${failures} 张图片受跨域限制，已保留原背景；可改用“API 透明”`);
            }
            const actualOutputFormat = taskBackgroundMode === 'local-transparent' ? 'png' : taskOutputFormat;
            const items = await recordImages(returnedImages, {
                prompt: taskPrompt,
                modelId: data.model?.id,
                modelName: data.model?.name,
                providerName: data.model?.provider,
                aspectRatio: requestRatio,
                outputSize,
                outputFormat: actualOutputFormat,
                generationMs: durationMs,
                source: taskRefs.length ? 'edit' : 'generate',
                references: referenceRecords,
                angle: taskRequest.angle
            });
            const info = `${data.model?.name || '图片模型'} · ${outputSize || '自动分辨率'} · ${taskRefs.length ? '参考图生成' : '文本生成'} · ${(durationMs / 1000).toFixed(1)}s · ${items.length} 张`;
            setResultItems((old)=>[
                    ...items,
                    ...old
                ]);
            patchGenerateTask(taskId, {
                status: 'success',
                completedAt: Date.now(),
                info,
                items
            });
            if (isAngleGeneration) {
                setAngleResults(items);
                setAngleReference(taskRefs[0] || null);
                if (items.length) {
                    setAngleResultToast(items[0]);
                    setAngleSuppressAutoOpenId(items[0].id);
                }
            }
            if (items.length) playSuccessSound();
            setLastGenerateInfo(info);
            void refreshGenerationLogs();
        } catch (error) {
            const message = error instanceof Error ? error.message : '生成失败';
            patchGenerateTask(taskId, {
                status: 'error',
                completedAt: Date.now(),
                error: message,
                info: `${taskModel?.displayName || '图片模型'} · 生成失败`
            });
            registerGenerationFailure();
            void refreshGenerationLogs();
            notify(message);
        }
    }
    async function submitAngleGeneration(input) {
        setAngleBusy(true);
        setAngleReference(input.reference);
        try {
            await submitGenerate(undefined, {
                prompt: input.prompt,
                references: [
                    input.reference,
                    input.guideReference
                ],
                modelId: input.camera.modelId,
                angle: input.camera,
                angleStart: input.cameraStart || undefined,
                angleNote: input.note,
                angleGuide: true,
                angleOutput: input.output
            });
        } finally{
            setAngleBusy(false);
        }
    }
    function openAngleResultFromToast() {
        if (!angleResultToast) return;
        markHistoryImageViewed(angleResultToast);
        setSection('angle');
        setAngleResultOpenRequest(angleResultToast.id);
        setAngleResultToast(null);
    }
    async function persistAgentSession(id, nextMessages) {
        const storedMessages = normalizeAssistantImageSources(nextMessages.filter((message)=>!message.pending).map(({ pending: _pending, ...message })=>message));
        if (!storedMessages.length) return;
        const now = Date.now();
        const existing = chatSessions.find((session)=>session.id === id);
        const firstUser = storedMessages.find((message)=>message.role === 'user')?.content.trim() || '新对话';
        const session = {
            id,
            title: existing?.title || firstUser.slice(0, 30),
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            messages: storedMessages
        };
        const previous = chatSaveQueuesRef.current.get(id) || Promise.resolve();
        const operation = previous.catch(()=>undefined).then(async ()=>{
            await saveChatSession(session);
            setChatSessions((old)=>[
                    session,
                    ...old.filter((item)=>item.id !== id)
                ].sort((a, b)=>b.updatedAt - a.updatedAt));
        });
        chatSaveQueuesRef.current.set(id, operation);
        try {
            await operation;
        } finally {
            if (chatSaveQueuesRef.current.get(id) === operation) chatSaveQueuesRef.current.delete(id);
        }
    }
    function setChatBusy(id, busy) {
        const next = new Set(busyChatIdsRef.current);
        if (busy) next.add(id);
        else next.delete(id);
        busyChatIdsRef.current = next;
        setBusyChatIds([
            ...next
        ]);
    }
    function isCurrentAgentRequest(sessionId, requestId) {
        return agentRequestsRef.current.get(sessionId)?.requestId === requestId;
    }
    async function finalizeStoppedAgentRequest(sessionId, request) {
        const currentMessages = pendingChatMessagesRef.current.get(sessionId) || (activeChatIdRef.current === sessionId ? messages : []);
        const stoppedMessages = currentMessages.map((message)=>{
            if (message.id !== request.pendingId) return message;
            if (request.kind === 'retry') {
                const versions = messageVersionsFor(message).map((version)=>version.id === request.retryVersionId ? {
                        ...version,
                        content: request.partialText?.trim() || '本轮回答已停止。',
                        interrupted: true
                    } : version);
                return applyMessageVersion({
                    ...message,
                    retrying: false
                }, versions, versions.findIndex((version)=>version.id === request.retryVersionId));
            }
            const { pending: _pending, activity: _activity, ...rest } = message;
            return {
                ...rest,
                content: request.partialText?.trim() || '本轮回答已停止。',
                interrupted: true
            };
        });
        pendingChatMessagesRef.current.set(sessionId, stoppedMessages);
        if (activeChatIdRef.current === sessionId) setMessages(stoppedMessages);
        setChatBusy(sessionId, false);
        await persistAgentSession(sessionId, stoppedMessages).catch(()=>undefined);
    }
    async function stopAgent() {
        const sessionId = activeChatIdRef.current;
        if (!sessionId) return;
        const request = agentRequestsRef.current.get(sessionId);
        if (!request) return;
        request.stopped = true;
        request.controller.abort(new Error('AGENT_CANCELLED'));
        agentRequestsRef.current.delete(sessionId);
        await finalizeStoppedAgentRequest(sessionId, request);
    }
    function resetMessageSelection() {
        setAgentMessageSelectionMode(false);
        setSelectedAgentMessages(new Set());
    }
    function resetShareSelection() {
        setShareSelectionMode(false);
        setSelectedShareGroups(new Set());
    }
    function beginShareSelection() {
        if (!messages.length) return notify('当前对话还没有可分享的内容');
        if (!selectableShareGroups.length) return notify('当前对话还没有可分享的已完成内容');
        setShareSelectionMode(true);
        setSelectedShareGroups(new Set());
    }
    function toggleShareGroupSelection(id) {
        const group = shareGroups.find((item)=>item.id === id);
        if (!group?.selectable) return;
        setSelectedShareGroups((old)=>{
            const next = new Set(old);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    function toggleAllShareGroups() {
        const allSelected = selectableShareGroups.length > 0 && selectableShareGroups.every((group)=>selectedShareGroups.has(group.id));
        setSelectedShareGroups(allSelected ? new Set() : new Set(selectableShareGroups.map((group)=>group.id)));
    }
    function clearShareGroupSelection() {
        setSelectedShareGroups(new Set());
    }
    function closeSidebarOnMobile() {
        if (window.matchMedia('(max-width: 780px)').matches) setSidebarOpen(false);
    }
    function startNewChat() {
        pauseChatAutoFollow();
        activeChatIdRef.current = null;
        setActiveChatId(null);
        setMessages([]);
        setAgentRefs([]);
        setAgentFiles([]);
        setAgentInput('');
        setAgentFollowUp(null);
        resetMessageSelection();
        resetShareSelection();
        setSection('agent');
    }
    function openChatSession(session) {
        const normalized = normalizeChatSession(session);
        activeChatIdRef.current = session.id;
        setActiveChatId(session.id);
        setMessages(pendingChatMessagesRef.current.get(session.id) || normalized.messages);
        setAgentRefs([]);
        setAgentFiles([]);
        setAgentInput('');
        setAgentFollowUp(null);
        resetMessageSelection();
        resetShareSelection();
        setSection('agent');
        requestChatScrollAfterCommit();
    }
    function beginChatRename(session) {
        if (chatSelectionMode) return;
        setRenamingChatId(session.id);
        setRenamingChatTitle(session.title);
    }
    function cancelChatRename() {
        setRenamingChatId(null);
        setRenamingChatTitle('');
    }
    async function commitChatRename(session) {
        const title = renamingChatTitle.trim().slice(0, 48);
        if (!title) {
            cancelChatRename();
            notify('对话名称不能为空');
            return;
        }
        cancelChatRename();
        const latest = chatSessions.find((item)=>item.id === session.id) || session;
        if (latest.title === title) return;
        const renamed = {
            ...latest,
            title
        };
        setChatSessions((old)=>old.map((item)=>item.id === session.id ? renamed : item));
        try {
            await saveChatSession(renamed);
            notify('对话已重命名');
        } catch (error) {
            setChatSessions((old)=>old.map((item)=>item.id === session.id ? latest : item));
            notify(error instanceof Error ? error.message : '重命名失败');
        }
    }
    async function deleteChatSessions(ids) {
        const selectedIds = new Set(ids.filter((id)=>!busyChatIdsRef.current.has(id)));
        if (!selectedIds.size) return;
        await Promise.all([
            ...selectedIds
        ].map((id)=>removeChatSession(id)));
        const remaining = chatSessions.filter((item)=>!selectedIds.has(item.id));
        setChatSessions(remaining);
        for (const id of selectedIds)pendingChatMessagesRef.current.delete(id);
        setSelectedChatSessions((old)=>new Set([
                ...old
            ].filter((id)=>!selectedIds.has(id))));
        if (activeChatIdRef.current && selectedIds.has(activeChatIdRef.current)) {
            const next = remaining[0];
            activeChatIdRef.current = next?.id || null;
            setActiveChatId(next?.id || null);
            setMessages(next?.messages || []);
            setAgentFollowUp(null);
            resetMessageSelection();
        }
    }
    function askDeleteChatSession(session) {
        if (busyChatIdsRef.current.has(session.id)) {
            notify('当前对话正在回答，完成后再删除');
            return;
        }
        setConfirmState({
            title: '删除这段对话？',
            text: `将从本机助手历史中删除“${session.title || '未命名对话'}”，此操作不可恢复。`,
            danger: true,
            confirmText: '确认删除',
            action: async ()=>{
                await deleteChatSessions([session.id]);
                notify('对话已删除');
            }
        });
    }
    function toggleChatSelectionMode() {
        setChatSelectionMode((old)=>!old);
        setSelectedChatSessions(new Set());
    }
    function toggleChatSessionSelection(id) {
        if (busyChatIdsRef.current.has(id)) return;
        setSelectedChatSessions((old)=>{
            const next = new Set(old);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    function toggleAllChatSessionSelection() {
        const selectableIds = chatSessions.filter((session)=>!busyChatIdsRef.current.has(session.id)).map((session)=>session.id);
        const allSelected = selectableIds.length > 0 && selectableIds.every((id)=>selectedChatSessions.has(id));
        setSelectedChatSessions(allSelected ? new Set() : new Set(selectableIds));
    }
    async function deleteSelectedChatSessions() {
        const ids = [
            ...selectedChatSessions
        ].filter((id)=>!busyChatIdsRef.current.has(id));
        if (!ids.length) return;
        await deleteChatSessions(ids);
        setChatSelectionMode(false);
        setSelectedChatSessions(new Set());
        notify(`已删除 ${ids.length} 段对话`);
    }
    function followUpRequestContent(question, followUp) {
        if (!followUp?.content) return question;
        const label = followUp.role === 'assistant' ? '助手回复' : '你的消息';
        return `请围绕下面引用的${label}继续回答。\n\n<引用内容>\n${followUp.content}\n</引用内容>\n\n用户的追问：\n${question}`;
    }
    function followUpFromMessage(message) {
        const source = message.content.trim();
        if (!source) return notify('这条消息没有可追问的文字内容');
        const excerpt = source.length > 6000 ? `${source.slice(0, 6000)}\n\n（内容过长，已截取前 6000 字）` : source;
        setAgentFollowUp({
            messageId: message.id,
            role: message.role,
            content: excerpt
        });
        setAgentMentionOpen(false);
        requestAnimationFrame(()=>{
            const input = agentInputRef.current;
            if (!input) return;
            input.focus();
            input.setSelectionRange(input.value.length, input.value.length);
        });
        notify('已引用这条消息，可直接补充你的追问');
    }
    function beginAgentMessageSelection() {
        if (shareSelectionMode) return notify('请先完成或取消分享选择');
        if (messages.some((message)=>message.pending)) return notify('请等当前消息生成完成后再批量删除');
        if (activeChatIdRef.current && busyChatIdsRef.current.has(activeChatIdRef.current)) return notify('当前对话正在回答，完成后再批量删除');
        setAgentMessageSelectionMode(true);
        setSelectedAgentMessages(new Set());
    }
    function toggleAgentMessageSelection(id) {
        setSelectedAgentMessages((old)=>{
            const next = new Set(old);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }
    async function deleteSelectedAgentMessages() {
        if (!selectedAgentMessages.size) return;
        const sessionId = activeChatIdRef.current;
        if (sessionId && busyChatIdsRef.current.has(sessionId)) return notify('当前对话正在回答，完成后再删除消息');
        const nextMessages = messages.filter((item)=>!selectedAgentMessages.has(item.id));
        if (sessionId) {
            pendingChatMessagesRef.current.set(sessionId, nextMessages);
            if (nextMessages.length) await persistAgentSession(sessionId, nextMessages);
            else {
                await removeChatSession(sessionId);
                pendingChatMessagesRef.current.delete(sessionId);
                setChatSessions((old)=>old.filter((item)=>item.id !== sessionId));
                if (activeChatIdRef.current === sessionId) {
                    activeChatIdRef.current = null;
                    setActiveChatId(null);
                }
            }
        }
        setMessages(nextMessages);
        if (agentFollowUp && selectedAgentMessages.has(agentFollowUp.messageId)) setAgentFollowUp(null);
        resetMessageSelection();
        notify('已删除所选消息');
    }
    function switchAgentMessageVersion(message, nextIndex) {
        if (message.retrying) return;
        pauseChatAutoFollow();
        const versions = messageVersionsFor(message);
        const activeVersion = Math.min(Math.max(0, nextIndex), versions.length - 1);
        if (activeVersion === messageVersionIndex(message)) return;
        const beforeTop = messageViewportTop(message.id);
        const nextMessages = messages.map((item)=>item.id === message.id ? applyMessageVersion(item, versions, activeVersion) : item);
        setMessages(nextMessages);
        restoreMessageViewport(message.id, beforeTop);
        const sessionId = activeChatIdRef.current;
        if (sessionId) {
            pendingChatMessagesRef.current.set(sessionId, nextMessages);
            void persistAgentSession(sessionId, nextMessages).catch(()=>notify('切换版本后保存失败'));
        }
    }
    function retryAgentImage(message) {
        const image = message.images?.[0];
        if (!image) return;
        if (!availableGenerationModels.length) return notify('还没有可用图片模型，请先到模型库启用生图模型');
        reuseItem(image);
        setSection('generate');
        notify('已打开新的图片生成窗口，并带入原提示词和参数');
    }
    async function continueAgentFromImage(message, direction) {
        const image = latestAssistantImage([
            message
        ]);
        if (!image) return;
        const sessionId = activeChatIdRef.current;
        if (sessionId && busyChatIdsRef.current.has(sessionId)) return notify('当前对话正在回答，请等本轮完成后再续图');
        markHistoryImageViewed(image);
        try {
            const reference = await galleryItemToReference(image);
            setSection('agent');
            await sendAgent(buildContinuationPrompt(direction), undefined, [
                reference
            ]);
        } catch (error) {
            notify(error instanceof Error ? error.message : '读取上一张生成图片失败，暂时不能续图');
        }
    }
    async function continueAgentFromChat(message, direction) {
        if (!direction?.trim()) return;
        const sessionId = activeChatIdRef.current;
        if (sessionId && busyChatIdsRef.current.has(sessionId)) return notify('当前对话正在回答，请等本轮完成后再继续');
        setSection('agent');
        await sendAgent(direction);
    }
    async function retryAgentMessage(message) {
        if (message.images?.length) return retryAgentImage(message);
        if (message.retrying) return;
        pauseChatAutoFollow();
        const sessionId = activeChatIdRef.current;
        if (!sessionId) return notify('请先发送一条消息后再重新生成');
        if (busyChatIdsRef.current.has(sessionId)) return notify('当前对话正在回答，完成后再重新生成');
        const messageIndex = messages.findIndex((item)=>item.id === message.id);
        if (messageIndex < 0) return;
        const contextMessages = messages.slice(0, messageIndex).filter((item)=>!item.pending);
        if (!contextMessages.some((item)=>item.role === 'user')) return notify('找不到这条回复对应的提问，暂时无法重新生成');
        const originalVersions = messageVersionsFor(message);
        const originalActiveVersion = messageVersionIndex(message);
        const beforeTop = messageViewportTop(message.id);
        const retryVersionId = uid('reply-version');
        // 保留当前版本的正文，避免重试开始时内容瞬间缩短导致浏览器把页面夹到底部。
        const retryVersion = {
            id: retryVersionId,
            content: message.content,
            images: message.images,
            files: message.files,
            webSearch: message.webSearch,
            webSearchDecision: message.webSearchDecision,
            createdAt: Date.now()
        };
        const workingVersions = [
            ...originalVersions,
            retryVersion
        ];
        const workingVersionIndex = workingVersions.length - 1;
        const workingMessages = messages.map((item)=>item.id === message.id ? applyMessageVersion(item, workingVersions, workingVersionIndex, true) : item);
        const requestId = uid('agent-request');
        const requestController = new AbortController();
        const agentRequest = { requestId, controller: requestController, pendingId: message.id, retryVersionId, kind: 'retry', partialText: '', stopped: false };
        agentRequestsRef.current.set(sessionId, agentRequest);
        pendingChatMessagesRef.current.set(sessionId, workingMessages);
        setMessages(workingMessages);
        setChatBusy(sessionId, true);
        const isCurrentRequest = ()=>isCurrentAgentRequest(sessionId, requestId);
        try {
            const latestUserId = [
                ...contextMessages
            ].reverse().find((item)=>item.role === 'user')?.id;
            const referenceSource = [
                ...contextMessages
            ].reverse().find((item)=>item.role === 'user' && item.references?.length);
            const referencesForRequest = await Promise.all((referenceSource?.references || []).slice(0, 16).map(async (reference)=>compressReferenceDataUrl(reference.dataUrl)));
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const referenceRecords = await persistReferenceImages(referenceSource?.references || []);
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const payloadMessages = contextMessages.slice(-12).map((item)=>({
                    role: item.role,
                    content: item.content,
                    references: item.id === latestUserId ? referencesForRequest : [],
                    files: item.id === latestUserId ? (item.files || []).map((file)=>({
                            name: file.name,
                            mimeType: file.mimeType,
                            content: file.content,
                            encoding: file.encoding,
                            size: file.size
                        })) : []
                }));
            payloadMessages.push({
                role: 'user',
                content: '请基于上面的对话重新生成一版完整答复。不要提及“重试”或“版本”，直接回答原问题。',
                references: [],
                files: []
            });
            const res = await fetch('/api/agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: payloadMessages,
                    referenceImages: referenceRecords,
                    model: activeAgentModelId,
                    webMode: agentWebMode,
                    webSearch: agentWebMode !== 'off',
                    stream: true
                }),
                signal: requestController.signal
            });
            let data;
            if (res.headers.get('content-type')?.includes('text/event-stream')) {
                let streamedText = '';
                const final = await readAgentStream(res, (event)=>{
                    if (event.type === 'delta') {
                        streamedText += String(event.text || '');
                        agentRequest.partialText = streamedText;
                        if (isCurrentRequest()) {
                            const current = pendingChatMessagesRef.current.get(sessionId) || workingMessages;
                            const updated = current.map((item)=>{
                                if (item.id !== message.id) return item;
                                const versions = messageVersionsFor(item).map((version)=>version.id === retryVersionId ? { ...version, content: streamedText } : version);
                                return applyMessageVersion(item, versions, workingVersionIndex, true);
                            });
                            pendingChatMessagesRef.current.set(sessionId, updated);
                            if (activeChatIdRef.current === sessionId) setMessages(updated);
                        }
                    }
                    if (event.type === 'error') throw new Error(event.message || '助手流式响应失败');
                }, requestController.signal);
                data = {
                    ...final,
                    message: final.message || streamedText
                };
            } else data = await res.json();
            if (!res.ok) throw new Error(data.error || '助手请求失败');
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            void refreshGenerationLogs();
            let images = [];
            if (Array.isArray(data.images) && data.images.length) {
                const generation = Array.isArray(data.generations) ? data.generations[0] : null;
                images = await recordImages(data.images, {
                    prompt: generation?.prompt || message.content,
                    modelId: generation?.modelId,
                    modelName: generation?.modelName,
                    providerName: generation?.providerName,
                    aspectRatio: generation?.aspectRatio || '自动',
                    source: 'agent',
                    references: referenceRecords
                });
                if (images.length) playSuccessSound();
            }
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const files = Array.isArray(data.files) ? data.files.filter((file)=>file && typeof file.name === 'string' && typeof file.content === 'string').map((file)=>({
                    id: uid('file'),
                    name: file.name,
                    mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
                    content: file.content,
                    encoding: file.encoding === 'base64' ? 'base64' : 'utf8',
                    size: typeof file.size === 'number' ? file.size : undefined
                })) : [];
            const completedMessages = (pendingChatMessagesRef.current.get(sessionId) || workingMessages).map((item)=>{
                if (item.id !== message.id) return item;
                const versions = messageVersionsFor(item).map((version)=>version.id === retryVersionId ? {
                        ...version,
                        content: data.message || '已完成。',
                        images,
                        files,
                        webSearch: data.webSearch || undefined,
                        webSearchDecision: data.webSearchDecision || undefined
                    } : version);
                return applyMessageVersion(item, versions, versions.findIndex((version)=>version.id === retryVersionId));
            });
            if (!isCurrentRequest()) return;
            pendingChatMessagesRef.current.delete(sessionId);
            if (activeChatIdRef.current === sessionId) {
                setMessages(completedMessages);
                restoreMessageViewport(message.id, beforeTop);
            }
            agentRequestsRef.current.delete(sessionId);
            setChatBusy(sessionId, false);
            await persistAgentSession(sessionId, completedMessages);
            notify(`已生成第 ${workingVersions.length} 个文本版本`);
        } catch (error) {
            const errorName = error instanceof Error ? error.name : '';
            const errorMessage = error instanceof Error ? error.message : '';
            const cancelled = agentRequest.stopped || requestController.signal.aborted || errorName === 'AbortError' || errorMessage === 'AGENT_CANCELLED';
            if (cancelled) {
                if (isCurrentRequest()) {
                    agentRequest.stopped = true;
                    agentRequestsRef.current.delete(sessionId);
                    await finalizeStoppedAgentRequest(sessionId, agentRequest);
                }
                return;
            }
            if (!isCurrentRequest()) return;
            const restoredMessages = messages.map((item)=>item.id === message.id ? applyMessageVersion(item, originalVersions, originalActiveVersion) : item);
            pendingChatMessagesRef.current.delete(sessionId);
            if (activeChatIdRef.current === sessionId) setMessages(restoredMessages);
            notify(error instanceof Error ? error.message : '重新生成失败');
            void refreshGenerationLogs();
        } finally{
            if (isCurrentRequest()) {
                agentRequestsRef.current.delete(sessionId);
                setChatBusy(sessionId, false);
            }
        }
    }
    async function sendAgent(text = agentInput, task, overrideRefs) {
        if (agentMessageSelectionMode) return notify('请先完成或取消删除选择');
        if (shareSelectionMode) return notify('请先完成或取消分享选择');
        const content = text.trim();
        if (!content && !agentFiles.length && !agentRefs.length) return;
        if (!availableChatModels.length) return notify('还没有可用对话模型，请先去模型库勾选');
        const sessionId = activeChatId || uid('chat');
        if (busyChatIdsRef.current.has(sessionId)) return notify('当前对话正在回答，可点击左侧“新对话”并行进行');
        const currentSessionMessages = pendingChatMessagesRef.current.get(sessionId) || messages;
        let refs = overrideRefs ? [
            ...overrideRefs
        ] : [
            ...agentRefs
        ];
        let autoContinuation = false;
        if (!overrideRefs && !refs.length && isImageContinuationRequest(content)) {
            const previousImage = latestAssistantImage(currentSessionMessages);
            if (previousImage) {
                try {
                    refs = [
                        await galleryItemToReference(previousImage)
                    ];
                    autoContinuation = true;
                } catch (error) {
                    return notify(error instanceof Error ? error.message : '无法读取上一张生成图片，暂时不能续图');
                }
            }
        }
        if (refs.some((reference)=>reference.pending)) return notify('参考图正在准备，请稍候片刻再发送');
        const files = overrideRefs ? [] : [
            ...agentFiles
        ];
        const followUp = overrideRefs ? null : agentFollowUp;
        const requestContent = autoContinuation ? buildContinuationPrompt(content) : content || '请分析我上传的文件和参考图';
        const likelyImageRequest = !task && (isImageContinuationRequest(requestContent) || likelyImageGenerationRequest(requestContent));
        const user = {
            id: uid('msg'),
            role: 'user',
            content: requestContent,
            references: refs,
            files,
            followUp: followUp || undefined
        };
        const pendingId = uid('msg');
        const pending = {
            id: pendingId,
            role: 'assistant',
            content: likelyImageRequest ? '正在构思画面…' : '正在判断是否需要联网…',
            pending: true,
            activity: likelyImageRequest ? { stage: 'image_planning', message: '正在构思画面…' } : { stage: 'web_search', message: '正在判断是否需要联网…' }
        };
        const requestId = uid('agent-request');
        const requestController = new AbortController();
        const agentRequest = { requestId, controller: requestController, pendingId, partialText: '', stopped: false };
        agentRequestsRef.current.set(sessionId, agentRequest);
        primeSuccessSound();
        const nextMessages = [
            ...currentSessionMessages.filter((message)=>!message.pending),
            user
        ];
        activeChatIdRef.current = sessionId;
        pendingChatMessagesRef.current.set(sessionId, [
            ...nextMessages,
            pending
        ]);
        setActiveChatId(sessionId);
        setMessages([
            ...nextMessages,
            pending
        ]);
        requestChatScrollAfterCommit();
        setAgentInput('');
        setAgentRefs([]);
        setAgentFiles([]);
        setAgentFollowUp(null);
        setChatBusy(sessionId, true);
        const isCurrentRequest = ()=>isCurrentAgentRequest(sessionId, requestId);
        await persistAgentSession(sessionId, nextMessages).catch(()=>undefined);
        if (requestController.signal.aborted || !isCurrentRequest()) return;
        try {
            const updatePendingMessage = (patch)=>{
                if (!isCurrentRequest()) return;
                const current = pendingChatMessagesRef.current.get(sessionId) || [
                    ...nextMessages,
                    pending
                ];
                const updated = current.map((message)=>message.id === pendingId ? {
                            ...message,
                            ...patch
                        } : message);
                pendingChatMessagesRef.current.set(sessionId, updated);
                if (activeChatIdRef.current === sessionId) setMessages(updated);
            };
            const updatePendingContent = (nextContent)=>{
                agentRequest.partialText = nextContent;
                updatePendingMessage({ content: nextContent });
            };
            const updatePendingActivity = (activity)=>{
                updatePendingMessage({
                    content: activity?.message,
                    activity
                });
            };
            const latestUserId = [
                ...nextMessages
            ].reverse().find((message)=>message.role === 'user')?.id;
            const referenceSource = [
                ...nextMessages
            ].reverse().find((message)=>message.role === 'user' && message.references?.length);
            const referencesForRequest = await Promise.all((referenceSource?.references || []).slice(0, 16).map(async (reference)=>compressReferenceDataUrl(reference.dataUrl)));
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const referenceRecords = await persistReferenceImages(referenceSource?.references || []);
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const payloadMessages = nextMessages.slice(-12).map((m)=>({
                    role: m.role,
                    content: m.id === latestUserId ? followUpRequestContent(m.content, m.followUp) : m.content,
                    references: m.id === latestUserId ? referencesForRequest : [],
                    files: m.id === latestUserId ? (m.files || []).map((file)=>({
                            name: file.name,
                            mimeType: file.mimeType,
                            content: file.content,
                            encoding: file.encoding,
                            size: file.size
                        })) : []
                }));
            updatePendingActivity(likelyImageRequest ? { stage: 'image_planning', message: '正在构思画面…' } : { stage: 'web_search', message: '正在判断是否需要联网…' });
            const res = await fetch('/api/agent', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messages: payloadMessages,
                    referenceImages: referenceRecords,
                    model: activeAgentModelId,
                    task,
                    webMode: agentWebMode,
                    webSearch: agentWebMode !== 'off',
                    stream: true
                }),
                signal: requestController.signal
            });
            let data;
            if (res.headers.get('content-type')?.includes('text/event-stream')) {
                let streamedText = '';
                const final = await readAgentStream(res, (event)=>{
                    if (event.type === 'status') updatePendingActivity({
                        stage: event.stage || 'answering',
                        message: event.message || '正在处理…',
                        model: event.model,
                        mode: event.mode,
                        count: event.count
                    });
                    if (event.type === 'delta') {
                        streamedText += String(event.text || '');
                        updatePendingContent(streamedText);
                    }
                    if (event.type === 'error') throw new Error(event.message || '助手流式响应失败');
                }, requestController.signal);
                data = {
                    ...final,
                    message: final.message || streamedText
                };
            } else data = await res.json();
            if (!res.ok) throw new Error(data.error || '助手请求失败');
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            void refreshGenerationLogs();
            const submittedChatModel = activeAgentModelId !== 'auto' ? availableChatModels.find((model)=>model.id === activeAgentModelId) : undefined;
            const actualChatModelId = submittedChatModel?.id || (Array.isArray(data.generations) ? data.generations[0]?.modelId : undefined);
            const actualChatModel = actualChatModelId ? state.models.find((model)=>model.id === actualChatModelId) : undefined;
            const usedChatModel = submittedChatModel || actualChatModel || (activeAgentModelId === 'auto' ? activeAgentChatModel : undefined);
            recordModelCall({
                context: 'agent',
                mode: submittedChatModel ? 'manual' : 'auto',
                providerId: usedChatModel?.providerId,
                modelId: usedChatModel?.id,
                params: {
                    webMode: agentWebMode,
                    webSearch: agentWebMode !== 'off'
                }
            });
            let items = [];
            if (Array.isArray(data.images) && data.images.length) {
                const gen = Array.isArray(data.generations) ? data.generations[0] : null;
                items = await recordImages(data.images, {
                    prompt: gen?.prompt || requestContent,
                    modelId: gen?.modelId,
                    modelName: gen?.modelName,
                    providerName: gen?.providerName,
                    aspectRatio: gen?.aspectRatio || '自动',
                    source: 'agent',
                    references: referenceRecords
                });
                if (items.length) playSuccessSound();
            }
            if (requestController.signal.aborted || !isCurrentRequest()) return;
            const files = Array.isArray(data.files) ? data.files.filter((file)=>file && typeof file.name === 'string' && typeof file.content === 'string').map((file)=>({
                    id: uid('file'),
                    name: file.name,
                    mimeType: typeof file.mimeType === 'string' ? file.mimeType : 'application/octet-stream',
                    content: file.content,
                    encoding: file.encoding === 'base64' ? 'base64' : 'utf8',
                    size: typeof file.size === 'number' ? file.size : undefined
                })) : [];
            const completed = [
                ...nextMessages,
                {
                    id: pendingId,
                    role: 'assistant',
                    content: data.message || '已完成。',
                    images: items,
                    files,
                    webSearch: data.webSearch || undefined,
                    webSearchDecision: data.webSearchDecision || undefined
                }
            ];
            if (!isCurrentRequest()) return;
            pendingChatMessagesRef.current.delete(sessionId);
            if (activeChatIdRef.current === sessionId) setMessages(completed);
            agentRequestsRef.current.delete(sessionId);
            setChatBusy(sessionId, false);
            await persistAgentSession(sessionId, completed);
        } catch (error) {
            const errorName = error instanceof Error ? error.name : '';
            const errorMessage = error instanceof Error ? error.message : '';
            const cancelled = agentRequest.stopped || requestController.signal.aborted || errorName === 'AbortError' || errorMessage === 'AGENT_CANCELLED';
            if (cancelled) {
                if (isCurrentRequest()) {
                    agentRequest.stopped = true;
                    agentRequestsRef.current.delete(sessionId);
                    await finalizeStoppedAgentRequest(sessionId, agentRequest);
                }
                return;
            }
            if (!isCurrentRequest()) return;
            const failed = [
                ...nextMessages,
                {
                    id: pendingId,
                    role: 'assistant',
                    content: `请求失败：${error instanceof Error ? error.message : '未知错误'}`
                }
            ];
            pendingChatMessagesRef.current.delete(sessionId);
            if (activeChatIdRef.current === sessionId) setMessages(failed);
            await persistAgentSession(sessionId, failed).catch(()=>undefined);
            void refreshGenerationLogs();
        } finally{
            if (isCurrentRequest()) {
                agentRequestsRef.current.delete(sessionId);
                setChatBusy(sessionId, false);
            }
        }
    }
    async function toggleFavorite(item) {
        await patchGalleryItem(item.id, {
            favorite: !item.favorite
        });
        setGallery((old)=>old.map((x)=>x.id === item.id ? {
                    ...x,
                    favorite: !x.favorite
                } : x));
        setResultItems((old)=>old.map((x)=>x.id === item.id ? {
                    ...x,
                    favorite: !x.favorite
                } : x));
        setGenerateTasks((old)=>old.map((task)=>({
                    ...task,
                    items: task.items.map((x)=>x.id === item.id ? {
                            ...x,
                            favorite: !x.favorite
                        } : x)
                })));
    }
    async function reversePrompt(item) {
        if (!availableChatModels.length) return notify('还没有可用对话模型，请先去模型库勾选');
        markHistoryImageViewed(item);
        try {
            let ref;
            if (item.url.startsWith('data:image/')) ref = {
                id: uid('ref'),
                name: `历史-${item.id.slice(-6)}`,
                dataUrl: item.url
            };
            else {
                const response = await fetch(item.url);
                if (!response.ok) throw new Error('无法读取历史图片');
                const blob = await response.blob();
                ref = await fileToReference(new File([
                    blob
                ], `历史-${item.id.slice(-6)}.png`, {
                    type: blob.type || 'image/png'
                }), {
                    compressForChat: true
                });
            }
            setSection('agent');
            await sendAgent('请根据这张图片反推提示词', 'reverse_prompt', [
                ref
            ]);
        } catch (error) {
            notify(error instanceof Error ? error.message : '反推提示词失败');
        }
    }
    async function reversePromptFromReferences() {
        if (!agentRefs.length) return notify('请先上传一张参考图');
        if (!availableChatModels.length) return notify('还没有可用对话模型，请先去模型库勾选');
        if (agentRefs.length === 1) {
            await sendAgent('请根据我上传的参考图反推提示词', 'reverse_prompt', agentRefs);
            return;
        }
        await sendAgent('请按我上传参考图的顺序，将 Image 1、Image 2、Image 3……串联成一段 15 秒、一镜到底的 Seedance 2.0 视频生成 Prompt。只输出最终可直接使用的 VIDEO PROMPT。', 'one_take_video_prompt', agentRefs);
    }
    async function optimizeAgentPrompt() {
        const source = agentInput.trim();
        if (!source) return notify('请先在输入框写下想表达的画面内容');
        if (!availableChatModels.length) return notify('还没有可用对话模型，请先去模型库勾选');
        if (promptOptimizing) return;
        setPromptOptimizing(true);
        try {
            const optimized = await requestPromptOptimization(source, activeAgentModelId);
            setAgentInput(optimized);
            requestAnimationFrame(()=>{
                agentInputRef.current?.focus();
                agentInputRef.current?.setSelectionRange(optimized.length, optimized.length);
            });
            notify('已完成 AI 优化，可继续修改后发送');
        } catch (error) {
            notify(error instanceof Error ? error.message : 'AI 优化失败');
        } finally{
            setPromptOptimizing(false);
        }
    }
    async function optimizeGeneratePrompt() {
        const source = generatePrompt.trim();
        if (!source) return notify('请先在提示词框写下想生成的画面内容');
        if (generateUpscaleMode) return notify('图片超分模式不需要优化生图提示词');
        if (!availableChatModels.length) return notify('还没有可用对话模型，请先去模型库勾选');
        if (generatePromptOptimizing || generateRefs.some((reference)=>reference.pending)) return;
        setGeneratePromptOptimizing(true);
        try {
            const references = await Promise.all(generateRefs.slice(0, 4).map(async (reference)=>compressReferenceDataUrl(reference.dataUrl)));
            const optimized = await requestPromptOptimization(source, activeAgentModelId, references);
            setGeneratePromptBeforeOptimization(generatePrompt);
            setGeneratePrompt(optimized);
            setGenerateMentionOpen(false);
            requestAnimationFrame(()=>{
                generatePromptRef.current?.focus();
                generatePromptRef.current?.setSelectionRange(optimized.length, optimized.length);
            });
            notify(references.length ? '已结合参考图完成 AI 优化，可继续修改后生成' : '已完成 AI 优化，可继续修改后生成');
        } catch (error) {
            notify(error instanceof Error ? error.message : 'AI 优化失败');
        } finally{
            setGeneratePromptOptimizing(false);
        }
    }
    function undoGeneratePromptOptimization() {
        if (generatePromptBeforeOptimization === null) return;
        setGeneratePrompt(generatePromptBeforeOptimization);
        setGeneratePromptBeforeOptimization(null);
        setGenerateMentionOpen(false);
        window.setTimeout(()=>generatePromptRef.current?.focus(), 0);
        notify('已撤销 AI 优化');
    }
    function reuseItem(item) {
        setGeneratePrompt(item.prompt);
        setGeneratePromptBeforeOptimization(null);
        setGenerateWorkflow('generate');
        setGenerateModelId(item.modelId && availableGenerationModels.some((m)=>m.id === item.modelId) ? item.modelId : 'auto');
        setRatio(item.aspectRatio === '自定义' ? '1:1' : item.aspectRatio || '自动');
        setGenerateRefs([]);
        const dimensions = item.outputSize?.split('×').map(Number);
        if (dimensions?.length === 2 && dimensions.every((value)=>value > 0)) {
            const longEdge = Math.max(dimensions[0], dimensions[1]);
            const tier = sizeTiers.find((option)=>option.longEdge === longEdge);
            if (tier) {
                setSizeMode('system');
                setSizeTier(tier.value);
            } else {
                setSizeMode('custom');
                setCustomWidth(dimensions[0]);
                setCustomHeight(dimensions[1]);
            }
        } else {
            const storedTier = sizeTiers.find((option)=>item.outputSize?.toUpperCase().startsWith(option.label));
            if (storedTier) setSizeTier(storedTier.value);
            setSizeMode(item.aspectRatio === '自定义' ? 'custom' : 'system');
        }
        setSection('generate');
        notify('已带入原图参数，可修改后重新生成');
    }
    async function galleryItemToReference(item) {
        if (item.url.startsWith('data:image/')) return {
            id: uid('ref'),
            name: `历史-${item.id.slice(-6)}`,
            dataUrl: item.url
        };
        let sourceUrl = item.url;
        if (/^https?:\/\//i.test(sourceUrl)) {
            const cacheResponse = await fetch('/api/storage/images', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    images: [
                        {
                            url: sourceUrl
                        }
                    ]
                })
            });
            const cacheData = await cacheResponse.json().catch(()=>({}));
            const cachedUrl = cacheData?.images?.[0]?.url;
            if (!cacheResponse.ok || typeof cachedUrl !== 'string' || cachedUrl === sourceUrl) throw new Error('服务端无法读取这张远程图片，可能是图片链接已失效');
            sourceUrl = cachedUrl;
        }
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error('无法读取历史图片');
        const blob = await response.blob();
        return fileToReference(new File([
            blob
        ], `历史-${item.id.slice(-6)}.png`, {
            type: blob.type || 'image/png'
        }), {
            compressForChat: true
        });
    }
    async function openAngleConsole(item) {
        markHistoryImageViewed(item);
        const requestId = uid('angle-open');
        const hasImmediateImage = item.url.startsWith('data:image/');
        const optimisticRef = {
            id: uid('ref'),
            name: `历史-${item.id.slice(-6)}`,
            dataUrl: item.url,
            pending: true
        };
        angleOpenRequestRef.current = requestId;
        setAngleReference(optimisticRef);
        setAngleCameraSeed(item.angle || null);
        setAngleCameraStartSeed(null);
        setAngleResults([]);
        setAngleOpenBusy(true);
        setSection('angle');
        notify('正在打开角度控制台，正在准备参考图…');
        if (hasImmediateImage) {
            window.setTimeout(()=>{
                if (angleOpenRequestRef.current !== requestId) return;
                setAngleReference((current)=>current?.id === optimisticRef.id ? {
                        ...current,
                        pending: false
                    } : current);
                setAngleOpenBusy(false);
                notify('已将历史图片带入角度控制台');
            }, 450);
            return;
        }
        try {
            const ref = await galleryItemToReference(item);
            if (angleOpenRequestRef.current !== requestId) return;
            setAngleReference({
                ...ref,
                id: optimisticRef.id,
                pending: false
            });
            setAngleOpenBusy(false);
            notify('已将历史图片带入角度控制台');
        } catch (error) {
            if (angleOpenRequestRef.current === requestId) {
                setAngleOpenBusy(false);
                setAngleReference(null);
                notify(error instanceof Error ? error.message : '读取历史图片失败');
            }
        }
    }
    async function useAsReference(item, target = 'generate') {
        markHistoryImageViewed(item);
        const optimisticRef = {
            id: uid('ref'),
            name: `历史-${item.id.slice(-6)}.png`,
            dataUrl: item.url,
            pending: true
        };
        const updateRefs = target === 'agent' ? setAgentRefs : setGenerateRefs;
        updateRefs((old)=>[
                optimisticRef,
                ...old
            ].slice(0, 16));
        setSection(target);
        notify(target === 'agent' ? '已加入助手参考图，正在后台准备…' : '已加入生图参考图，正在后台准备…');
        void galleryItemToReference(item).then((preparedRef)=>{
            updateRefs((old)=>old.map((ref)=>ref.id === optimisticRef.id ? {
                        ...preparedRef,
                        id: optimisticRef.id,
                        pending: false
                    } : ref));
        }).catch((error)=>{
            updateRefs((old)=>old.filter((ref)=>ref.id !== optimisticRef.id));
            notify(error instanceof Error ? error.message : '读取历史图片失败');
        });
    }
    function editorDefaults() {
        return {
            sizeMode: 'system',
            sizeTier: '1k',
            customWidth: 1024,
            customHeight: 1024,
            targetSize: 'auto',
            seed: 42,
            colorCorrection: 'wavelet',
            algorithm: 'lanczos',
            upscaleOutputFormat: 'png',
            upscaleOutputQuality: 95,
            mask: null
        };
    }
    function openEdit(item) {
        setEditorMaskOpen(false);
        if (!availableEditModels.length) return notify('还没有支持图片修改的模型，请先到模型库启用带“修改”能力的图片模型。');
        markHistoryImageViewed(item);
        const lastCall = getLastModelCall('edit');
        const saved = lastCall?.params || {};
        const dimensions = outputDimensions(item.outputSize);
        const ratio = item.aspectRatio || (dimensions ? exactRatioFromDimensions(dimensions.width, dimensions.height) : '自动');
        const tier = dimensions ? sizeTierFromDimensions(dimensions.width, dimensions.height) : '1k';
        const preset = presetDimensions(ratio === '自动' ? '1:1' : ratio, tier);
        const useCustomSize = Boolean(dimensions && (dimensions.width !== preset.width || dimensions.height !== preset.height));
        const rememberedModel = lastCall?.mode === 'manual' && lastCall.modelId && availableEditModels.some((model)=>model.id === lastCall.modelId) ? lastCall.modelId : 'auto';
        const rememberedRatio = typeof saved.ratio === 'string' && ratios.includes(saved.ratio) ? saved.ratio : ratio;
        const rememberedSizeMode = saved.sizeMode === 'system' || saved.sizeMode === 'custom' ? saved.sizeMode : useCustomSize ? 'custom' : 'system';
        const rememberedTier = sizeTiers.some((entry)=>entry.value === saved.sizeTier) ? saved.sizeTier : tier;
        setEditor({
            mode: 'edit',
            item,
            prompt: '',
            modelId: rememberedModel,
            ratio: rememberedRatio,
            count: typeof saved.count === 'number' ? Math.max(1, Math.min(8, Math.round(saved.count))) : 1,
            quality: typeof saved.quality === 'string' ? saved.quality : '自动',
            fidelity: saved.fidelity === 'low' ? 'low' : 'high',
            scale: 2,
            ...editorDefaults(),
            sizeMode: rememberedSizeMode,
            sizeTier: rememberedTier,
            customWidth: typeof saved.customWidth === 'number' && saved.customWidth > 0 ? Math.round(saved.customWidth) : dimensions?.width || preset.width,
            customHeight: typeof saved.customHeight === 'number' && saved.customHeight > 0 ? Math.round(saved.customHeight) : dimensions?.height || preset.height
        });
        if (lastCall) notify('已恢复上次图片修改设置');
    }
    function openUpscale(item) {
        setEditorMaskOpen(false);
        if (!availableUpscaleModels.length) return notify('还没有可用的超分模型。请到模型库重新读取并启用 SeedVR2-7B。');
        markHistoryImageViewed(item);
        const lastCall = getLastModelCall('upscale');
        const saved = lastCall?.params || {};
        const rememberedModel = lastCall?.mode === 'manual' && lastCall.modelId && availableUpscaleModels.some((model)=>model.id === lastCall.modelId) ? lastCall.modelId : 'auto';
        const dimensions = outputDimensions(item.outputSize);
        const ratio = item.aspectRatio || (dimensions ? exactRatioFromDimensions(dimensions.width, dimensions.height) : '自动');
        setEditor({
            mode: 'upscale',
            item,
            prompt: '',
            modelId: rememberedModel,
            ratio,
            count: 1,
            quality: 'high',
            fidelity: 'high',
            scale: [
                1,
                2,
                3,
                4
            ].includes(saved.upscaleScale) ? saved.upscaleScale : 2,
            ...editorDefaults(),
            sizeMode: 'system',
            sizeTier: dimensions ? sizeTierFromDimensions(dimensions.width, dimensions.height) : '1k',
            customWidth: dimensions?.width || 1024,
            customHeight: dimensions?.height || 1024,
            targetSize: saved.upscaleTarget === 'auto' || saved.upscaleTarget === '1K' || saved.upscaleTarget === '2K' || saved.upscaleTarget === '4K' ? saved.upscaleTarget : 'auto',
            seed: typeof saved.upscaleSeed === 'number' ? Math.max(0, Math.round(saved.upscaleSeed)) : 42,
            colorCorrection: saved.upscaleColorCorrection === 'none' ? 'none' : 'wavelet',
            algorithm: saved.upscaleAlgorithm === 'bicubic' || saved.upscaleAlgorithm === 'nearest' ? saved.upscaleAlgorithm : 'lanczos',
            upscaleOutputFormat: saved.upscaleOutputFormat === 'jpg' || saved.upscaleOutputFormat === 'bmp' ? saved.upscaleOutputFormat : 'png',
            upscaleOutputQuality: typeof saved.upscaleOutputQuality === 'number' && saved.upscaleOutputQuality >= 30 && saved.upscaleOutputQuality <= 100 ? Math.round(saved.upscaleOutputQuality) : 95
        });
        if (lastCall) notify('已恢复上次图片超分设置');
    }
    function openOutpaintEditor(item) {
        markHistoryImageViewed(item);
        setViewerId(null);
        setOutpaintEditor({
            item
        });
    }
    async function publishOutpaintReference(result) {
        if (!outpaintEditor) return;
        const item = outpaintEditor.item;
        const ref = {
            id: uid('ref'),
            name: `扩图白底-${item.id.slice(-6)}.png`,
            dataUrl: result.dataUrl
        };
        setGenerateRefs((old)=>[
                ref,
                ...old.filter((existing)=>existing.id !== ref.id)
            ].slice(0, 16));
        setGenerateWorkflow('generate');
        setGeneratePrompt('Remove white area and fill the scene');
        setGeneratePromptBeforeOptimization(null);
        setSizeMode('custom');
        setCustomWidth(result.width);
        setCustomHeight(result.height);
        setRatio(ratioFromDimensions(result.width, result.height));
        setGenerateMask(null);
        const preferredGenerateModelId = availableGenerationModels.find((model)=>model.id === generateModelId)?.id || availableGenerationModels[0]?.id || 'auto';
        if (generateModelId !== preferredGenerateModelId) setGenerateModelId(preferredGenerateModelId);
        setOutpaintEditor(null);
        setSection('generate');
        window.setTimeout(()=>generatePromptRef.current?.focus(), 0);
        notify('已发布到生图参考图，并填入扩图提示词');
    }
    async function saveLocalImageEdit(result, operations) {
        if (!outpaintEditor) return;
        const item = outpaintEditor.item;
        const label = operations.length ? `本地处理：${operations.join('、')}` : '本地处理：导出副本';
        const items = await recordImages([
            {
                url: result.dataUrl,
                revisedPrompt: label
            }
        ], {
            prompt: item.prompt,
            modelName: '本地图片工具',
            providerName: '本地处理',
            aspectRatio: ratioFromDimensions(result.width, result.height),
            outputSize: `${result.width}×${result.height}`,
            outputFormat: 'png',
            source: 'edit',
            parentId: item.id
        });
        setResultItems((old)=>[
                ...items,
                ...old
            ]);
        setOutpaintEditor(null);
        setSection('generate');
        notify(`已生成本地处理版本${operations.length ? `：${operations.join('、')}` : ''}`);
    }
    function runEditor(e) {
        e.preventDefault();
        const currentEditor = editor;
        if (!currentEditor) return;
        if (currentEditor.mode !== 'upscale' && !currentEditor.prompt.trim()) return notify(currentEditor.mode === 'edit' ? '请描述要怎么修改' : '提示词不能为空');
        const taskId = uid('edit-task');
        const taskPrompt = currentEditor.mode === 'upscale' ? currentEditor.item.prompt || 'Upscale this image' : currentEditor.prompt.trim();
        const taskMode = currentEditor.mode;
        setGenerateTasks((old)=>[
                {
                    id: taskId,
                    status: 'pending',
                    mode: taskMode,
                    prompt: taskPrompt,
                    expectedCount: 1,
                    startedAt: Date.now(),
                    info: `${currentEditor.mode === 'upscale' ? '图片超分' : '图片修改'} · 后台处理中`,
                    items: [],
                    itemIds: [],
                    request: currentEditor.mode === 'upscale' ? { sourceImageId: currentEditor.item.id, upscaleScale: currentEditor.scale, upscaleOutputFormat: currentEditor.upscaleOutputFormat, upscaleOutputQuality: currentEditor.upscaleOutputQuality, modelId: currentEditor.modelId, references: [{ id: currentEditor.item.id, name: `上一版-${currentEditor.item.id.slice(-6)}`, dataUrl: currentEditor.item.url }] } : undefined
                },
                ...old
            ]);
        setGenerateClock(Date.now());
        setEditorMaskOpen(false);
        setEditor(null);
        notify('已提交后台任务，可以关闭修改窗口或继续修改下一张；完成后会自动进入创作记录。');
        void processEditorTask(currentEditor, taskId);
    }
    async function waitForUpscaleTask(taskId, initialData = {}) {
        let lastData = initialData;
        for (let attempt = 0; attempt < 120; attempt += 1) {
            await new Promise((resolve)=>window.setTimeout(resolve, attempt === 0 ? 800 : 2000));
            const response = await fetch(`/api/upscale/tasks/${encodeURIComponent(taskId)}`, { cache: 'no-store' });
            const data = await response.json().catch(()=>({}));
            if (!response.ok) throw new Error(data.error || '读取高清任务状态失败');
            lastData = { ...lastData, ...data, taskId, status: data.task?.status || data.status, images: data.images || lastData.images };
            if (lastData.status === 'succeeded') return lastData;
            if (lastData.status === 'failed') throw new Error(data.task?.error || '高清处理失败');
        }
        throw new Error('高清处理时间较长，请稍后重试。');
    }
    async function processEditorTask(currentEditor, taskId) {
        const requestStartedAt = performance.now();
        const editorReference = {
            id: currentEditor.item.id,
            name: `上一版-${currentEditor.item.id.slice(-6)}`,
            url: currentEditor.item.url
        };
        try {
            const sourceSize = currentEditor.mode === 'upscale' ? await loadImageDimensions(currentEditor.item.url) : null;
            const editorUpscaleModel = currentEditor.mode === 'upscale' ? availableUpscaleModels.find((model)=>model.id === currentEditor.modelId) || defaultUpscaleModel : null;
            const targetSize = sourceSize ? upscalePreviewDimensions(sourceSize, currentEditor.scale, editorUpscaleModel, currentEditor.targetSize) : null;
             const upscaleSize = targetSize ? `${targetSize.width}x${targetSize.height}` : '';
             const cloudUpscale = currentEditor.mode === 'upscale' && isCloudUpscaleModel(editorUpscaleModel);
             const editorCloudOutputFormat = cloudUpscale && editorUpscaleModel?.outputFormats?.includes(currentEditor.upscaleOutputFormat) ? currentEditor.upscaleOutputFormat : undefined;
            const editRatio = editorRatio(currentEditor);
            const editDimensions = currentEditor.sizeMode === 'custom' ? {
                width: currentEditor.customWidth,
                height: currentEditor.customHeight
            } : presetDimensions(editRatio, currentEditor.sizeTier);
            const endpoint = currentEditor.mode === 'upscale' ? '/api/upscale' : '/api/edit';
            const body = currentEditor.mode === 'upscale' ? {
                taskId,
                sourceImageId: currentEditor.item.id,
                model: currentEditor.modelId,
                reference: currentEditor.item.url,
                 referenceImages: [editorReference],
                 scale: currentEditor.scale,
                 ...(cloudUpscale ? {
                    ...(editorCloudOutputFormat ? { outputFormat: editorCloudOutputFormat } : {}),
                    ...(editorCloudOutputFormat === 'jpg' ? { outputQuality: currentEditor.upscaleOutputQuality } : {})
                } : {
                    size: upscaleSize,
                    seed: currentEditor.seed,
                    colorCorrection: currentEditor.colorCorrection,
                    resizeMethod: currentEditor.algorithm
                }),
                prompt: currentEditor.prompt
            } : {
                taskId,
                prompt: currentEditor.prompt.trim(),
                model: currentEditor.modelId,
                aspectRatio: editRatio,
                count: currentEditor.count,
                width: editDimensions.width,
                height: editDimensions.height,
                resolution: currentEditor.sizeMode === 'custom' ? undefined : currentEditor.sizeTier.toUpperCase(),
                quality: currentEditor.quality,
                fidelity: currentEditor.fidelity,
                references: [
                    currentEditor.item.url
                ],
                referenceImages: [editorReference],
                mask: currentEditor.mask || undefined
            };
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            let data = await res.json();
            if (!res.ok) throw new Error(data.error || '处理失败');
            if (currentEditor.mode === 'upscale' && data.taskId) patchGenerateTask(taskId, { upscaleTaskId: data.taskId, info: `${data.model?.name || '高清放大'} · 后台处理中` });
            if (currentEditor.mode === 'upscale' && data.taskId && (data.status === 'queued' || data.status === 'processing')) data = await waitForUpscaleTask(data.taskId, data);
            const knownUpscaleModels = [
                ...state.models,
                ...(state.upscaleModels || [])
            ];
            const manualModel = currentEditor.modelId !== 'auto' ? knownUpscaleModels.find((model)=>model.id === currentEditor.modelId) : undefined;
            const actualModel = data.model?.id ? knownUpscaleModels.find((model)=>model.id === data.model.id) : undefined;
            recordModelCall({
                context: currentEditor.mode === 'upscale' ? 'upscale' : 'edit',
                mode: manualModel ? 'manual' : 'auto',
                providerId: (manualModel || actualModel)?.providerId,
                modelId: (manualModel || actualModel)?.id,
                params: currentEditor.mode === 'upscale' ? {
                    upscaleScale: currentEditor.scale,
                    ...(cloudUpscale ? {
                        upscaleOutputFormat: editorCloudOutputFormat,
                        upscaleOutputQuality: editorCloudOutputFormat === 'jpg' ? currentEditor.upscaleOutputQuality : undefined
                    } : {
                        upscaleTarget: currentEditor.targetSize,
                        upscaleSeed: currentEditor.seed,
                        upscaleColorCorrection: currentEditor.colorCorrection,
                        upscaleAlgorithm: currentEditor.algorithm
                    })
                } : {
                    ratio: currentEditor.ratio,
                    count: currentEditor.count,
                    quality: currentEditor.quality,
                    fidelity: currentEditor.fidelity,
                    sizeMode: currentEditor.sizeMode,
                    sizeTier: currentEditor.sizeTier,
                    customWidth: currentEditor.customWidth,
                    customHeight: currentEditor.customHeight
                }
            });
            const durationMs = Math.round(performance.now() - requestStartedAt);
            const items = await recordImages(data.images || [], {
                prompt: currentEditor.mode === 'upscale' ? currentEditor.item.prompt : currentEditor.prompt,
                modelId: data.model?.id,
                modelName: data.model?.name,
                providerName: data.model?.provider,
                aspectRatio: currentEditor.ratio,
                outputSize: currentEditor.mode === 'upscale' ? `${currentEditor.scale}× 超分` : undefined,
                outputFormat: currentEditor.mode === 'upscale' && editorCloudOutputFormat ? editorCloudOutputFormat === 'jpg' ? 'jpeg' : editorCloudOutputFormat : currentEditor.mode === 'upscale' ? 'png' : undefined,
                source: currentEditor.mode === 'upscale' ? 'upscale' : 'edit',
                parentId: currentEditor.item.id,
                sourceImageId: currentEditor.mode === 'upscale' ? currentEditor.item.id : undefined,
                upscaleProvider: currentEditor.mode === 'upscale' ? data.model?.provider : undefined,
                upscaleModel: currentEditor.mode === 'upscale' ? data.model?.id : undefined,
                upscaleScale: currentEditor.mode === 'upscale' ? currentEditor.scale : undefined,
                upscaleTaskId: currentEditor.mode === 'upscale' ? data.taskId : undefined,
                generationMs: durationMs,
                references: [editorReference]
            });
            const info = `${currentEditor.mode === 'upscale' ? '图片超分' : '图片修改'} · ${data.model?.name || '图片模型'} · ${(durationMs / 1000).toFixed(1)}s · ${items.length} 张`;
            setResultItems((old)=>[
                    ...items,
                    ...old
                ]);
            patchGenerateTask(taskId, {
                status: 'success',
                completedAt: Date.now(),
                info,
                items,
                itemIds: items.map((item)=>item.id)
            });
            if (items.length) playSuccessSound();
            void refreshGenerationLogs();
            notify(currentEditor.mode === 'upscale' ? '后台超分已完成，结果已返回创作记录。' : '后台图片修改已完成，结果已返回创作记录。');
        } catch (error) {
            const message = error instanceof Error ? error.message : '处理失败';
            patchGenerateTask(taskId, {
                status: 'error',
                completedAt: Date.now(),
                error: message,
                info: `${currentEditor.mode === 'upscale' ? '图片超分' : '图片修改'} · 处理失败`
            });
            void refreshGenerationLogs();
            notify(`后台${currentEditor.mode === 'upscale' ? '超分' : '图片修改'}失败：${message}`);
        }
    }
    function askDeleteItems(ids) {
        if (!ids.length) return;
        setConfirmState({
            title: ids.length > 1 ? `删除 ${ids.length} 张图片？` : '删除这张图片？',
            text: '删除后会从本机历史记录中移除，不会影响第三方服务商。',
            danger: true,
            confirmText: '确认删除',
            action: async ()=>{
                await removeGalleryItems(ids);
                setGallery((old)=>old.filter((x)=>!ids.includes(x.id)));
                setResultItems((old)=>old.filter((x)=>!ids.includes(x.id)));
                setGenerateTasks((old)=>old.map((task)=>({
                            ...task,
                            items: task.items.filter((x)=>!ids.includes(x.id)),
                            itemIds: task.itemIds?.filter((id)=>!ids.includes(id))
                        })));
                setSelectedHistory(new Set());
                if (viewerId && ids.includes(viewerId)) setViewerId(null);
                notify('已删除');
            }
        });
    }
    async function copyPrompt(text) {
        try {
            await navigator.clipboard.writeText(text);
            notify('提示词已复制');
        } catch  {
            notify('复制失败');
        }
    }
    async function copyMessage(text) {
        try {
            await navigator.clipboard.writeText(text);
            notify('消息已复制');
        } catch  {
            notify('复制失败');
        }
    }
    async function shareConversation() {
        if (shareBusy) return;
        if (!selectedShareMessages.length) return notify('请至少选择一组已完成的问答内容');
        if (activeAgentBusy || selectedShareMessages.some((message)=>message.pending)) return notify('请等待当前回答完成后再分享');
        setShareBusy(true);
        try {
            const result = await renderShareConversationImage(selectedShareMessages);
            const url = URL.createObjectURL(result.blob);
            setSharePreview({
                url,
                width: result.width,
                height: result.height,
                filename: `SANMAO-对话分享-${new Date().toISOString().slice(0, 10)}.png`
            });
        } catch (error) {
            notify(error instanceof Error ? error.message : '分享长图生成失败');
        } finally {
            setShareBusy(false);
        }
    }
    function downloadSharePreview() {
        if (!sharePreview) return;
        const anchor = document.createElement('a');
        anchor.href = sharePreview.url;
        anchor.download = sharePreview.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        notify('分享长图已下载');
    }
    async function copyAuthorWechat() {
        try {
            await navigator.clipboard.writeText('wcsanmao');
            notify('微信号已复制：wcsanmao');
        } catch  {
            notify('微信号：wcsanmao');
        }
    }
    function captureMessageSelection(container) {
        const selection = window.getSelection();
        const text = selection?.toString().trim() || '';
        if (!selection || selection.isCollapsed || !text || !selection.anchorNode || !selection.focusNode || !selection.rangeCount || !container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return setSelectionPush(null);
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const toolbarWidth = Math.min(360, Math.max(280, window.innerWidth - 24));
        const toolbarHeight = window.innerWidth <= 520 ? 146 : 126;
        const gap = 12;
        const showBelow = rect.top < toolbarHeight + gap + 18 && window.innerHeight - rect.bottom > rect.top;
        const selectionCenter = rect.left + rect.width / 2;
        const halfCard = toolbarWidth / 2;
        const x = Math.min(window.innerWidth - halfCard - 12, Math.max(halfCard + 12, selectionCenter));
        setSelectionPush({
            text,
            x,
            y: showBelow ? Math.min(window.innerHeight - gap, rect.bottom + gap) : Math.max(gap, rect.top - gap),
            placement: showBelow ? 'below' : 'above'
        });
    }
    function pushTextToGenerate(text, navigate = true) {
        const nextText = text.trim();
        if (!nextText) return;
        setGeneratePromptBeforeOptimization(null);
        setGeneratePrompt((current)=>{
            const existing = current.trimEnd();
            return existing ? `${existing}\n${nextText}` : nextText;
        });
        setSelectionPush(null);
        window.getSelection()?.removeAllRanges();
        if (navigate) {
            setSection('generate');
            window.setTimeout(()=>generatePromptRef.current?.focus(), 0);
            notify('已追加到生图提示词，并已跳转');
        } else {
            notify('已追加到生图提示词，可继续选择内容');
        }
    }
    function pushTextToVideo(text, navigate = true) {
        const nextText = text.trim();
        if (!nextText) return;
        if (!availableVideoModels.length) {
            setSelectionPush(null);
            notify('请先在模型库启用视频模型');
            return;
        }
        setVideoPromptPrefill((current)=>{
            const existing = current?.trimEnd() || '';
            return existing ? `${existing}\n${nextText}` : nextText;
        });
        setSelectionPush(null);
        window.getSelection()?.removeAllRanges();
        if (navigate) {
            setSection('video');
            notify('已追加到视频提示词，并已跳转');
        } else {
            notify('已追加到视频提示词，可继续选择内容');
        }
    }
    function resetViewerView() {
        setViewerZoom(1);
        setViewerPan({
            x: 0,
            y: 0
        });
    }
    const VIDEO_QUEUE_MAX = 20;

    function pushVideoQueueItem(item) {
        if (!availableVideoModels.length) {
            notify('请先在模型库启用视频模型');
            return false;
        }
        if (videoReferenceQueue.some((queued)=>queued.id === item.id)) {
            notify('该图片已在视频队列');
            return false;
        }
        if (videoReferenceQueue.length >= VIDEO_QUEUE_MAX) {
            notify('视频参考队列最多 ' + VIDEO_QUEUE_MAX + ' 张，请先清理');
            return false;
        }
        markHistoryImageViewed(item);
        setVideoReferenceQueue((current)=>[
            ...current,
            {
                id: item.id,
                url: item.url
            }
        ]);
        notify('已加入视频参考，可继续选择图片');
        return true;
    }
    function pushToVideo(item) {
        void pushVideoQueueItem(item);
    }
    function pushSelectedToVideo() {
        if (!availableVideoModels.length) {
            notify('请先在模型库启用视频模型');
            return;
        }
        const queuedIds = new Set(videoReferenceQueue.map((queued)=>queued.id));
        const additions = [];
        let duplicateCount = 0;
        for (const id of selectedHistory) {
            const item = gallery.find((entry)=>entry.id === id);
            if (!item) continue;
            if (queuedIds.has(item.id)) {
                duplicateCount++;
                continue;
            }
            if (videoReferenceQueue.length + additions.length >= VIDEO_QUEUE_MAX) break;
            queuedIds.add(item.id);
            additions.push({
                id: item.id,
                url: item.url
            });
        }
        if (!additions.length) {
            notify(duplicateCount ? '所选图片都已在视频队列' : '没有可推送的作品');
            return;
        }
        setVideoReferenceQueue((current)=>[
            ...current,
            ...additions
        ]);
        notify('已加入 ' + additions.length + ' 张到视频参考');
    }
    function clearVideoQueue() {
        setVideoReferenceQueue([]);
    }
    async function goVideoFromQueue() {
        if (!videoReferenceQueue.length) return;
        const queueSnapshot = videoReferenceQueue;
        const results = await Promise.allSettled(queueSnapshot.map(async (queued)=>{
            const item = gallery.find((entry)=>entry.id === queued.id) || gallery.find((entry)=>entry.url === queued.url);
            if (!item) throw new Error('找不到对应作品');
            const prepared = await galleryItemToReference(item);
            return {
                name: prepared.name,
                url: prepared.dataUrl,
                kind: 'image'
            };
        }));
        const resolved = [];
        let failedCount = 0;
        for (const result of results) {
            if (result.status === 'fulfilled') resolved.push(result.value);
            else failedCount++;
        }
        if (!resolved.length) {
            notify('没有可用的图片，请重试');
            return;
        }
        if (failedCount) notify('有 ' + failedCount + ' 张图片无法读取，已跳过');
        const capped = resolved.slice(0, VIDEO_QUEUE_MAX);
        setVideoMediaPrefill(capped);
        setVideoMediaPrefillToken((token)=>token + 1);
        setVideoReferenceQueue([]);
        setSection('video');
        if (!failedCount) notify('已带入 ' + capped.length + ' 张参考图到视频');
    }
    function adjustViewerZoom(next) {
        const value = Math.min(10, Math.max(0.25, Math.round(next * 20) / 20));
        setViewerZoom(value);
        if (value <= 1) setViewerPan({
            x: 0,
            y: 0
        });
    }
    function handleViewerWheel(event) {
        event.preventDefault();
        adjustViewerZoom(viewerZoom + (event.deltaY < 0 ? 0.1 : -0.1));
    }
    function handleViewerPointerDown(event) {
        if (viewerZoom <= 1 || event.target.closest('button')) return;
        const stage = event.currentTarget;
        viewerDragRef.current = {
            active: true,
            x: event.clientX,
            y: event.clientY,
            panX: viewerPan.x,
            panY: viewerPan.y
        };
        stage.setPointerCapture(event.pointerId);
        setViewerDragging(true);
        event.preventDefault();
    }
    function handleViewerPointerMove(event) {
        const drag = viewerDragRef.current;
        if (!drag.active) return;
        setViewerPan({
            x: drag.panX + event.clientX - drag.x,
            y: drag.panY + event.clientY - drag.y
        });
    }
    function handleViewerPointerUp(event) {
        if (!viewerDragRef.current.active) return;
        viewerDragRef.current.active = false;
        setViewerDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }
    function scrollModelLibrary(position) {
        if (typeof window === 'undefined') return;
        window.scrollTo({
            top: position === 'bottom' ? document.documentElement.scrollHeight : 0,
            behavior: 'smooth'
        });
    }
    function renderModelCard(model) {
        const inUse = model.enabled && model.published;
        const favorite = modelFavorites.includes(model.id);
        const capabilityLabel = (cap)=>cap === 'chat' ? '对话' : cap === 'vision' ? '识图' : cap === 'edit' ? '改图' : cap === 'reference' ? '参考图' : cap === 'typography' ? '文字' : cap === 'generate' ? '生图' : cap === 'upscale' ? '超分' : cap === 'web-search' ? '原生联网' : cap === 'video-generate' ? '视频生成' : cap === 'video-edit' ? '视频编辑' : cap === 'video-extend' ? '视频扩展' : cap === 'video-first-frame' ? '首帧' : cap === 'video-reference' ? '多图参考' : cap === 'video-audio' ? '音频' : cap;
        return /*#__PURE__*/ _jsxs("article", {
            className: `model-card surface ${inUse ? 'in-use' : ''}`,
            children: [
                /*#__PURE__*/ _jsx("button", {
                    className: `use-check ${inUse ? 'checked' : ''}`,
                    onClick: ()=>void toggleModelUse(model),
                    title: inUse ? '停止使用' : '使用这个模型',
                    children: inUse && /*#__PURE__*/ _jsx(Icon, {
                        name: "check",
                        size: 15
                    })
                }),
                /*#__PURE__*/ _jsx("button", {
                    type: "button",
                    className: `model-card-favorite ${favorite ? 'active' : ''}`,
                    onClick: ()=>setModelFavorite(model.id, !favorite),
                    title: favorite ? '取消收藏' : '收藏模型',
                    children: "★"
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: "model-card-main",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "model-card-title",
                            children: [
                                /*#__PURE__*/ _jsx("strong", {
                                    children: model.displayName
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                className: `kind-badge ${model.kind}`,
                                    children: kindLabel(model.kind)
                                }),
                                model.billing && /*#__PURE__*/ _jsx("span", {
                                    className: `billing-badge ${model.billing}`,
                                    children: agnesBillingLabel(model.billing)
                                }),
                                inUse && /*#__PURE__*/ _jsx("span", {
                                    children: "使用中"
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("p", {
                            children: model.providerName
                        }),
                        /*#__PURE__*/ _jsx("small", {
                            title: model.rawId,
                            children: model.rawId
                        })
                    ]
                }),
                /*#__PURE__*/ _jsxs("div", {
                    className: "model-type-control",
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "model-type-control-label",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: "模型分类"
                                }),
                                /*#__PURE__*/ _jsx("em", {
                                    className: `model-kind-status ${model.kind}`,
                                    children: model.kind === 'unknown' ? '待分类' : kindLabel(model.kind).replace('模型', '')
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "segmented mini model-kind-segmented",
                            "aria-label": "模型分类",
                            children: [
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: `model-kind-option chat ${model.kind === 'chat' ? 'active' : ''}`,
                                    disabled: modelKindBusy.has(model.id),
                                    onClick: ()=>void setModelKind(model, 'chat'),
                                    children: "对话"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: `model-kind-option image ${model.kind === 'image' ? 'active' : ''}`,
                                    disabled: modelKindBusy.has(model.id),
                                    onClick: ()=>void setModelKind(model, 'image'),
                                    children: "图片"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: `model-kind-option video ${model.kind === 'video' ? 'active' : ''}`,
                                    disabled: modelKindBusy.has(model.id),
                                    onClick: ()=>void setModelKind(model, 'video'),
                                    children: "视频"
                                })
                            ]
                        })
                    ]
                }),
                 /*#__PURE__*/ _jsx("div", {
                     className: "capability-tags",
                     children: model.capabilities.slice(0, 5).map((cap)=>/*#__PURE__*/ _jsx("span", {
                             className: `capability-tag-${cap}`,
                             children: capabilityLabel(cap)
                         }, cap))
                 }),
            ]
        }, model.id);
    }
    const imageModeActive = section === 'generate' || section === 'angle' || section === 'history' || section === 'logs';
    return /*#__PURE__*/ _jsxs("main", {
        className: `app-shell ${section === 'angle' ? 'angle-app-shell' : ''} ${sidebarOpen ? 'sidebar-is-open' : ''}`,
        children: [
            /*#__PURE__*/ _jsx(UpdateNotice, {}),
            /*#__PURE__*/ _jsxs("aside", {
                className: `sidebar ${sidebarOpen ? 'expanded' : ''} ${section === 'agent' ? 'agent-context' : ''}`,
                "aria-label": "侧边导航",
                children: [
                    /*#__PURE__*/ _jsxs("div", {
                        className: "sidebar-head",
                        children: [
                            /*#__PURE__*/ _jsx("button", {
                                type: "button",
                                className: "sidebar-toggle",
                                "aria-label": sidebarOpen ? '收起侧边栏' : '展开侧边栏',
                                "aria-expanded": sidebarOpen,
                                onClick: ()=>setSidebarOpen((open)=>!open),
                                children: /*#__PURE__*/ _jsx(Icon, {
                                    name: sidebarOpen ? 'close' : 'menu',
                                    size: 18
                                })
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                className: "sidebar-brand",
                                onClick: ()=>{
                                    setSection('agent');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "brand-mark",
                                        children: /*#__PURE__*/ _jsx("img", {
                                            src: "/brand-mark.png",
                                            alt: ""
                                        })
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "SANMAO.AI"
                                    })
                                ]
                            })
                        ]
                    }),
                    section === 'agent' && /*#__PURE__*/ _jsxs("button", {
                        className: "new-chat",
                        "data-tooltip": "新对话",
                        onClick: ()=>{
                            startNewChat();
                            closeSidebarOnMobile();
                        },
                        children: [
                            /*#__PURE__*/ _jsx(Icon, {
                                name: "plus",
                                size: 17
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: "新对话"
                            })
                        ]
                    }),
                    sidebarOpen && section === 'agent' && /*#__PURE__*/ _jsxs(_Fragment, {
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "chat-history-head",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "助手历史"
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsx("b", {
                                                children: chatSessions.length || ''
                                            }),
                                            chatSessions.length > 0 && /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: `chat-history-batch ${chatSelectionMode ? 'active' : ''}`,
                                                onClick: toggleChatSelectionMode,
                                                children: chatSelectionMode ? '取消选择' : '批量删除'
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "chat-history-search",
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "search",
                                        size: 14
                                    }),
                                    /*#__PURE__*/ _jsx("input", {
                                        value: chatHistorySearch,
                                        onChange: (e)=>setChatHistorySearch(e.target.value),
                                        placeholder: "快速查找历史对话"
                                    }),
                                    chatHistorySearch && /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>setChatHistorySearch(''),
                                        children: "清空"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsx("div", {
                                className: "chat-history-list",
                                children: filteredChatSessions.length ? filteredChatSessions.map((session)=>{
                                    const busy = busyChatIds.includes(session.id);
                                    const renaming = renamingChatId === session.id;
                                    return /*#__PURE__*/ _jsxs("div", {
                                        className: `chat-history-item ${activeChatId === session.id ? 'active' : ''} ${chatSelectionMode ? 'selecting' : ''} ${renaming ? 'renaming' : ''}`,
                                        children: [
                                            renaming ? /*#__PURE__*/ _jsx("input", {
                                                className: "chat-history-rename",
                                                value: renamingChatTitle,
                                                maxLength: 48,
                                                autoFocus: true,
                                                onFocus: (event)=>event.currentTarget.select(),
                                                onChange: (event)=>setRenamingChatTitle(event.target.value),
                                                onBlur: ()=>void commitChatRename(session),
                                                onKeyDown: (event)=>{
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        void commitChatRename(session);
                                                    } else if (event.key === 'Escape') {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        cancelChatRename();
                                                    }
                                                }
                                            }) : /*#__PURE__*/ _jsxs("button", {
                                                className: "chat-history-open",
                                                title: "单击打开，双击重命名",
                                                onClick: ()=>chatSelectionMode ? toggleChatSessionSelection(session.id) : (openChatSession(session), closeSidebarOnMobile()),
                                                onDoubleClick: (event)=>{
                                                    event.preventDefault();
                                                    beginChatRename(session);
                                                },
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: session.title
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        className: busy ? 'busy' : '',
                                                        children: busy ? '正在回答…' : formatTime(session.updatedAt)
                                                    })
                                                ]
                                            }),
                                            chatSelectionMode && /*#__PURE__*/ _jsxs("label", {
                                                className: "chat-history-check",
                                                title: busy ? '正在回答，暂不能删除' : '选择这段对话',
                                                children: [
                                                    /*#__PURE__*/ _jsx("input", {
                                                        type: "checkbox",
                                                        checked: selectedChatSessions.has(session.id),
                                                        disabled: busy,
                                                        onChange: ()=>toggleChatSessionSelection(session.id)
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {})
                                                ]
                                            }),
                                            !chatSelectionMode && !renaming && /*#__PURE__*/ _jsx("button", {
                                                className: "chat-history-delete",
                                                title: busy ? '正在回答，暂不能删除' : '删除这段对话',
                                                disabled: busy,
                                                onClick: ()=>askDeleteChatSession(session),
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "trash",
                                                    size: 13
                                                })
                                            })
                                        ]
                                    }, session.id);
                                }) : /*#__PURE__*/ _jsx("div", {
                                    className: "chat-history-empty",
                                    children: chatSessions.length ? '没有找到匹配的历史对话' : '对话会自动保存在这里'
                                })
                            })
                        ]
                    }),
                    sidebarOpen && section === 'agent' && chatSelectionMode && /*#__PURE__*/ _jsxs("div", {
                        className: "chat-history-selection-bar",
                        children: [
                            /*#__PURE__*/ _jsx("button", {
                                type: "button",
                                className: "chat-history-select-all",
                                onClick: toggleAllChatSessionSelection,
                                children: allChatSessionsSelected ? '取消全选' : '全选'
                            }),
                            /*#__PURE__*/ _jsxs("span", {
                                children: [
                                    "已选 ",
                                    selectedChatSessions.size,
                                    " 段"
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                type: "button",
                                className: "chat-history-selection-delete",
                                disabled: !selectedChatSessions.size,
                                onClick: ()=>void deleteSelectedChatSessions(),
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "trash",
                                        size: 13
                                    }),
                                    "删除所选"
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsx("div", {
                        className: "nav-caption image-tools-caption",
                        children: "图片工具"
                    }),
                    /*#__PURE__*/ _jsxs("nav", {
                                className: "main-nav image-tools-nav",
                        children: [
                            /*#__PURE__*/ _jsxs("button", {
                                "aria-label": "角度控制台",
                                "data-tooltip": "角度控制台",
                                className: section === 'angle' ? 'active' : '',
                                onClick: ()=>{
                                    setSection('angle');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "adjust"
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "角度控制台"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                "aria-label": historyNotice ? '创作记录，有新的作品' : logErrorNotice ? '创作记录，有失败任务' : '创作记录',
                                "data-tooltip": historyNotice ? '创作记录 · 有新的作品' : logErrorNotice ? '创作记录 · 有失败任务' : '创作记录',
                                className: `${section === 'history' || section === 'logs' ? 'active' : ''} history-priority`,
                                onClick: ()=>{
                                    markHistoryNoticeSeen();
                                    const nextRecordTab = logErrorNotice ? 'tasks' : 'works';
                                    setRecordTab(nextRecordTab);
                                    setSection(nextRecordTab === 'tasks' ? 'logs' : 'history');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "history"
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "创作记录"
                                    }),
                                    (historyNotice || logErrorNotice) && /*#__PURE__*/ _jsx("i", {
                                        className: logErrorNotice ? "nav-notice-dot error" : "nav-notice-dot success",
                                        "aria-hidden": "true"
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsx("div", {
                        className: "nav-caption",
                        children: "管理"
                    }),
                    /*#__PURE__*/ _jsxs("nav", {
                        className: "main-nav management-nav",
                        children: [
                            /*#__PURE__*/ _jsxs("button", {
                                "aria-label": "模型库",
                                "data-tooltip": "模型库",
                                className: section === 'models' ? 'active' : '',
                                onClick: ()=>{
                                    setSection('models');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "model"
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "模型库"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                "aria-label": "接口服务商",
                                "data-tooltip": "接口服务商",
                                className: section === 'providers' ? 'active' : '',
                                onClick: ()=>{
                                    setSection('providers');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "plug"
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "接口服务商"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                "aria-label": "设置",
                                "data-tooltip": "设置",
                                className: section === 'settings' ? 'active' : '',
                                onClick: ()=>{
                                    setSection('settings');
                                    closeSidebarOnMobile();
                                },
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "settings"
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "设置"
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsx("div", {
                        className: "sidebar-fill"
                    }),
                    sidebarOpen && /*#__PURE__*/ _jsxs(_Fragment, {
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "runtime-card",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: `status-dot ${availableChatModels.length || availableImageModels.length || availableVideoModels.length ? 'online' : ''}`
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        children: [
                                            /*#__PURE__*/ _jsxs("strong", {
                                                children: [
                                                    "共 ",
                                                    availableImageModels.length + availableChatModels.length + availableVideoModels.length,
                                                    " 个可用模型"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("small", {
                                                children: [
                                                    availableImageModels.length,
                                                    " 图片 · ",
                                                    availableChatModels.length,
                                                    " 对话 · ",
                                                    availableVideoModels.length,
                                                    " 视频"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx("small", {
                                                children: state.providers.length ? '模型来自你添加的接口服务' : '还没有连接模型服务'
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("button", {
                                className: "author-contact support-card-launch",
                                type: "button",
                                onClick: ()=>{
                                    setSupportTab('community');
                                    setSupportOpen(true);
                                },
                                "aria-label": "打开交流与支持",
                                children: [
                                    /*#__PURE__*/ _jsx("span", {
                                        className: "author-contact-mark",
                                        children: /*#__PURE__*/ _jsx(Icon, {
                                            name: "wechat",
                                            size: 17
                                        })
                                    }),
                                    /*#__PURE__*/ _jsxs("span", {
                                        children: [
                                            /*#__PURE__*/ _jsx("strong", {
                                                children: "交流与支持"
                                            }),
                                            /*#__PURE__*/ _jsx("small", {
                                                children: "QQ群 1104660815 \xb7 赞赏码"
                                            })
                                        ]
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("button", {
                        className: "support-rail-button",
                        type: "button",
                        onClick: ()=>{
                            setSupportTab('community');
                            setSupportOpen(true);
                        },
                        "aria-label": "交流与支持",
                        "data-tooltip": "交流与支持",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "support-rail-icon",
                                children: "✦"
                            }),
                            /*#__PURE__*/ _jsx("span", {
                                children: "交流与支持"
                            })
                        ]
                    })
                ]
            }),
            /*#__PURE__*/ _jsxs("section", {
                className: "main-column",
                children: [
                    /*#__PURE__*/ _jsxs("header", {
                        className: "topbar",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "topbar-left",
                                children: [
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "mobile-sidebar-toggle",
                                        "aria-label": "打开导航",
                                        "aria-expanded": sidebarOpen,
                                        onClick: ()=>setSidebarOpen(true),
                                        children: /*#__PURE__*/ _jsx(Icon, {
                                            name: "menu",
                                            size: 18
                                        })
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "topbar-brand",
                                        onClick: ()=>setSection('agent'),
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "topbar-brand-mark",
                                                children: /*#__PURE__*/ _jsx("img", {
                                                    src: "/brand-mark.png",
                                                    alt: ""
                                                })
                                            }),
                                            /*#__PURE__*/ _jsx("strong", {
                                                children: "SANMAO.AI"
                                            })
                                        ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("nav", {
                                className: "top-mode-nav",
                                "aria-label": "创作类型",
                                children: [
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: imageModeActive ? 'active' : '',
                                        "aria-current": imageModeActive ? 'page' : undefined,
                                        onClick: ()=>{
                                            setSection('generate');
                                            closeSidebarOnMobile();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "image",
                                                size: 15
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "图片"
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: section === 'video' ? 'active' : '',
                                        "aria-label": "视频工作台",
                                        "aria-current": section === 'video' ? 'page' : undefined,
                                        onClick: ()=>{
                                            setSection('video');
                                            closeSidebarOnMobile();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "video",
                                                size: 15
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "视频"
                                            }),
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "coming-soon-mode",
                                        "aria-label": "音频，即将上线",
                                        onClick: ()=>notify('音频接口将在下一阶段接入'),
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "audio",
                                                size: 15
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "音频"
                                            }),
                                            /*#__PURE__*/ _jsx("small", {
                                                className: "mode-status",
                                                children: "即将上线"
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: section === 'agent' ? 'active' : '',
                                        "aria-current": section === 'agent' ? 'page' : undefined,
                                        onClick: ()=>{
                                            setSection('agent');
                                            closeSidebarOnMobile();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "agent",
                                                size: 15
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "Agent"
                                            })
                                        ]
                                    }),
                                ]
                            }),
                            /*#__PURE__*/ _jsx("div", {
                                className: "top-actions",
                                children: [
                                    /*#__PURE__*/ _jsxs(Link, {
                                        href: "/canvas",
                                        className: "super-canvas-entry",
                                        "aria-label": "超级画布",
                                        "data-tooltip": "超级画布 · 无限画布",
                                        onClick: ()=>{
                                            closeSidebarOnMobile();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "canvas",
                                                size: 16
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "超级画布"
                                            }),
                                            /*#__PURE__*/ _jsx("small", {
                                                className: "super-canvas-entry-badge",
                                                children: "NEW"
                                            })
                                        ]
                                    }),
                                    section === 'agent' && messages.length > 0 && (shareSelectionMode ? /*#__PURE__*/ _jsxs("div", {
                                        className: "conversation-share-controls",
                                        role: "toolbar",
                                        "aria-label": "分享内容选择",
                                        children: [
                                            /*#__PURE__*/ _jsxs("span", {
                                                className: "conversation-share-count",
                                                children: [
                                                    selectedShareGroups.size,
                                                    "/",
                                                    selectableShareGroups.length
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "conversation-share-control",
                                                disabled: !selectableShareGroups.length,
                                                onClick: toggleAllShareGroups,
                                                children: allShareGroupsSelected ? '取消全选' : '全选'
                                            }),
                                            /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "conversation-share-control",
                                                disabled: !selectedShareGroups.size,
                                                onClick: clearShareGroupSelection,
                                                children: '清空'
                                            }),
                                            /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "conversation-share-control",
                                                onClick: resetShareSelection,
                                                children: '取消'
                                            }),
                                            /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "conversation-share-control primary",
                                                disabled: shareBusy || !selectedShareMessages.length || activeAgentBusy || messages.some((message)=>message.pending),
                                                onClick: ()=>void shareConversation(),
                                                title: !selectedShareMessages.length ? '请先选择要分享的问答组' : activeAgentBusy || messages.some((message)=>message.pending) ? '请等待当前回答完成后分享' : '预览选中的对话长图',
                                                children: shareBusy ? '生成中…' : '预览'
                                            })
                                        ]
                                    }) : /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "conversation-share-entry",
                                        disabled: shareBusy || !selectableShareGroups.length,
                                        onClick: beginShareSelection,
                                        title: !selectableShareGroups.length ? '当前还没有可分享的已完成问答组' : '选择要分享的问答组',
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "share",
                                                size: 14
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: '分享'
                                            })
                                        ]
                                    }, "share-entry")),
                                    /*#__PURE__*/ _jsxs("button", {
                                        className: "theme-toggle",
                                        "aria-label": theme === 'light' ? '切换深色主题' : '切换浅色主题',
                                        onClick: toggleTheme,
                                        children: [
                                            theme === 'light' ? /*#__PURE__*/ _jsx(Icon, {
                                                name: "moon",
                                                size: 16
                                            }) : /*#__PURE__*/ _jsx(Icon, {
                                                name: "sun",
                                                size: 16
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: theme === 'light' ? '深色' : '浅色'
                                            })
                                        ]
                                    }, "theme-toggle")
                                ]
                            })
                        ]
                    }),
                    loadingState ? /*#__PURE__*/ _jsxs("div", {
                        className: "page-loading",
                        children: [
                            /*#__PURE__*/ _jsx("span", {
                                className: "loader"
                            }),
                            /*#__PURE__*/ _jsx("p", {
                                children: "正在读取本地配置…"
                            })
                        ]
                    }) : /*#__PURE__*/ _jsxs(_Fragment, {
                        children: [
                            section === 'agent' && /*#__PURE__*/ _jsxs("section", {
                                className: "agent-page",
                                onDragOver: (e)=>e.preventDefault(),
                                onDrop: (e)=>{
                                    e.preventDefault();
                                    if (e.dataTransfer.files?.length) void addAgentAttachments(e.dataTransfer.files);
                                },
                                children: [
                                    !messages.length ? /*#__PURE__*/ _jsxs("div", {
                                        className: "agent-welcome",
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "hero-orb",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "agent",
                                                    size: 28
                                                })
                                            }),
                                            /*#__PURE__*/ _jsx("h1", {
                                                children: "把想法交给 SANMAO.AI"
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                children: "助手负责理解需求、优化提示词、选择你已添加的模型。你可以上传参考图让模型分析，也可以直接让助手生成可下载的 Markdown、CSV、JSON、HTML 和代码文件。"
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "example-grid",
                                                children: examples.map((example)=>/*#__PURE__*/ _jsx("button", {
                                                        onClick: ()=>setAgentInput(example),
                                                        children: example
                                                    }, example))
                                            })
                                        ]
                                    }) : /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "message-list",
                                                children: [
                                            messages.map((message)=>/*#__PURE__*/ _jsxs("article", {
                                                    id: `message-${message.id}`,
                                                    className: `message ${message.role} ${message.interrupted ? 'interrupted' : ''} ${agentMessageSelectionActive ? 'selecting' : ''} ${shareSelectionMode && selectedShareGroups.has(shareGroupByMessageId.get(message.id)?.id) ? 'share-selected' : ''}`,
                                                    children: [
                                                        /*#__PURE__*/ _jsx("div", {
                                                            className: "message-avatar",
                                                            children: message.role === 'user' ? '你' : 'S'
                                                        }),
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            className: `message-body ${agentMessageSelectionActive ? 'selecting' : ''}`,
                                                            onMouseUp: (e)=>captureMessageSelection(e.currentTarget),
                                                            children: [
                                                                agentMessageSelectionMode && /*#__PURE__*/ _jsxs("label", {
                                                                    className: "message-selection-toggle",
                                                                    title: "选择这条消息",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("input", {
                                                                            type: "checkbox",
                                                                            checked: selectedAgentMessages.has(message.id),
                                                                            disabled: message.pending,
                                                                            onChange: ()=>toggleAgentMessageSelection(message.id)
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("span", {})
                                                                    ]
                                                                }),
                                                                shareSelectionMode && shareGroupByMessageId.get(message.id)?.messageIds[0] === message.id && /*#__PURE__*/ _jsxs("label", {
                                                                    className: "message-selection-toggle share-selection-toggle",
                                                                    title: shareGroupByMessageId.get(message.id)?.label || '选择问答组',
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("input", {
                                                                            type: "checkbox",
                                                                            checked: selectedShareGroups.has(shareGroupByMessageId.get(message.id)?.id),
                                                                            disabled: !shareGroupByMessageId.get(message.id)?.selectable,
                                                                            onChange: ()=>toggleShareGroupSelection(shareGroupByMessageId.get(message.id)?.id)
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("span", {})
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsxs("div", {
                                                                    className: "message-label",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: message.role === 'user' ? '你' : 'SANMAO.AI'
                                                                        }),
                                                                         message.role === 'assistant' && !message.pending && /*#__PURE__*/ _jsx("small", {
                                                                             children: "选中文字可一键推送生图或下载文件"
                                                                         }),
                                                                         message.role === 'assistant' && message.interrupted && /*#__PURE__*/ _jsx("small", {
                                                                             className: "message-interrupted-badge",
                                                                             children: "已停止"
                                                                         }),
                                                                         message.role === 'assistant' && !message.pending && (message.webSearch || message.webSearchDecision) && /*#__PURE__*/ _jsxs("small", {
                                                                             className: "message-web-badge",
                                                                             children: [
                                                                                 message.webSearchDecision?.status === 'disabled' ? '联网已关闭' : message.webSearchDecision?.status === 'failed' ? '联网搜索失败，已如实回答' : message.webSearch ? message.webSearch.source === 'native' ? '模型原生联网' : message.webSearch.fallbackFrom === 'native' ? '外部搜索 API（原生搜索失败后回退）' : '外部搜索 API' : '智能联网：本轮未触发',
                                                                                 message.webSearchDecision?.status === 'failed' ? ' · 未获得可靠来源' : message.webSearch?.resultCount ? ` · ${message.webSearch.resultCount} 条来源` : ''
                                                                             ]
                                                                         }),
                                                                        message.role === 'assistant' && !message.pending && messageVersionsFor(message).length > 1 && /*#__PURE__*/ _jsxs("div", {
                                                                            className: "message-version-switch",
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx("button", {
                                                                                    type: "button",
                                                                                    disabled: message.retrying || messageVersionIndex(message) === 0,
                                                                                    onClick: ()=>switchAgentMessageVersion(message, messageVersionIndex(message) - 1),
                                                                                    "aria-label": "查看上一版",
                                                                                    children: /*#__PURE__*/ _jsx(Icon, {
                                                                                        name: "left",
                                                                                        size: 13
                                                                                    })
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("span", {
                                                                                    children: [
                                                                                        messageVersionIndex(message) + 1,
                                                                                        " / ",
                                                                                        messageVersionsFor(message).length
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("button", {
                                                                                    type: "button",
                                                                                    disabled: message.retrying || messageVersionIndex(message) >= messageVersionsFor(message).length - 1,
                                                                                    onClick: ()=>switchAgentMessageVersion(message, messageVersionIndex(message) + 1),
                                                                                    "aria-label": "查看下一版",
                                                                                    children: /*#__PURE__*/ _jsx(Icon, {
                                                                                        name: "right",
                                                                                        size: 13
                                                                                    })
                                                                                })
                                                                            ]
                                                                        })
                                                                    ]
                                                                }),
                                                                message.references?.length ? /*#__PURE__*/ _jsx("div", {
                                                                    className: "message-refs",
                                                                    children: message.references.map((ref, index)=>/*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: "message-ref-thumb",
                                                                            title: `点击放大查看 · 参考图 ${index + 1} · ${ref.name}`,
                                                                            "aria-label": `放大查看参考图 ${index + 1}`,
                                                                            onClick: ()=>setMessageReferencePreview(ref),
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx("img", {
                                                                                    src: ref.dataUrl,
                                                                                    alt: ref.name
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("span", {
                                                                                    children: index + 1
                                                                                })
                                                                            ]
                                                                        }, ref.id))
                                                                }) : null,
                                                                message.images?.length ? /*#__PURE__*/ _jsx("div", {
                                                                    className: "message-images",
                                                                    children: message.images.map((item)=>/*#__PURE__*/ _jsx(ImageCard, {
                                                                            item: item,
                                                                            previousItem: getGalleryParent(item),
                                                                            onPreview: ()=>openViewer(item),
                                                                            onEdit: ()=>openEdit(item),
                                                                            onUpscale: ()=>openUpscale(item),
                                                                            onReuse: ()=>reuseItem(item),
                                                                            onReference: ()=>useAsReference(item, 'agent'),
                                                                            onCompare: ()=>openCompare(item),
                                                                            onReversePrompt: ()=>reversePrompt(item),
                                                                            onFavorite: ()=>void toggleFavorite(item),
                                                                            onDownload: ()=>void downloadUrl(item.url, `SANMAO-${item.id}.png`),
                                                                            onDownloadShare: ()=>downloadShareImage(item).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                                                            onDelete: ()=>askDeleteItems([
                                                                                    item.id
                                                                                ])
                                                                        }, item.id))
                                                                }) : null,
                                                                message.pending && /^(?:image_|caption)/.test(message.activity?.stage || '') ? /*#__PURE__*/ _jsx(AgentImageLoadingCard, {
                                                                    activity: message.activity
                                                                }) : message.role === 'assistant' && !message.pending ? /*#__PURE__*/ _jsx(AssistantMarkdown, {
                                                                    content: message.content,
                                                                    onNotify: notify,
                                                                    directionPicker: message.images?.length ? {
                                                                        kind: 'image',
                                                                        directions: extractAgentDirections(message.content),
                                                                         disabled: activeAgentBusy || agentMessageSelectionActive || message.retrying,
                                                                        onSelect: (direction)=>void continueAgentFromImage(message, direction)
                                                                    } : {
                                                                        kind: 'chat',
                                                                        directions: extractChatDirections(message.content),
                                                                         disabled: activeAgentBusy || agentMessageSelectionActive || message.retrying,
                                                                        onSelect: (direction)=>void continueAgentFromChat(message, direction)
                                                                    }
                                                                }) : /*#__PURE__*/ _jsx("p", {
                                                                    className: message.pending ? 'pending' : '',
                                                                    children: message.content
                                                                }),
                                                                message.files?.length ? /*#__PURE__*/ _jsx(ChatFileList, {
                                                                    files: message.files,
                                                                    onDownload: (file)=>{
                                                                        void downloadChatFile(file).catch(()=>notify('文件下载失败'));
                                                                    }
                                                                }) : null,
                                                                 !message.pending && !agentMessageSelectionActive && /*#__PURE__*/ _jsxs("div", {
                                                                    className: `message-tools ${message.role === 'user' ? 'user-message-tools' : ''}`,
                                                                    children: [
                                                                        /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            title: "复制消息",
                                                                            "aria-label": "复制消息",
                                                                            onClick: ()=>void copyMessage(message.content),
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                                    name: "copy",
                                                                                    size: 14
                                                                                }),
                                                                                "复制"
                                                                            ]
                                                                        }),
                                                                        message.role === 'assistant' && /*#__PURE__*/ _jsxs(_Fragment, {
                                                                            children: [
                                                                                /*#__PURE__*/ _jsxs("button", {
                                                                                    type: "button",
                                                                                    className: "message-followup",
                                                                                    title: "围绕此消息追问",
                                                                                    onClick: ()=>followUpFromMessage(message),
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx(Icon, {
                                                                                            name: "agent",
                                                                                            size: 14
                                                                                        }),
                                                                                        "围绕此条追问"
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("button", {
                                                                                    type: "button",
                                                                                    className: "message-retry",
                                                                                    disabled: message.retrying,
                                                                                    title: message.images?.length ? '在新的图片生成窗口中重新生成' : '在当前对话中生成一个新版本',
                                                                                    onClick: ()=>void retryAgentMessage(message),
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx(Icon, {
                                                                                            name: "retry",
                                                                                            size: 14
                                                                                        }),
                                                                                        message.retrying ? '重新生成中…' : message.images?.length ? '重新生成图片' : '重新生成文本'
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("button", {
                                                                                    type: "button",
                                                                                    onClick: ()=>pushTextToGenerate(message.content),
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx(Icon, {
                                                                                            name: "image",
                                                                                            size: 14
                                                                                        }),
                                                                                        "整段推送生图"
                                                                                    ]
                                                                                })
                                                                            ]
                                                                        }),
                                                                        /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: "message-delete",
                                                                            title: "批量删除消息",
                                                                            "aria-label": "批量删除消息",
                                                                            onClick: beginAgentMessageSelection,
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                                    name: "trash",
                                                                                    size: 14
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("span", {
                                                                                    children: "删除"
                                                                                })
                                                                            ]
                                                                        })
                                                                    ]
                                                                })
                                                            ]
                                                        })
                                                    ]
                                                }, message.id)),
                                             /*#__PURE__*/ _jsx("div", {
                                                 ref: chatEndRef
                                             })
                                         ]
                                     }),
                                     conversationItems.length > 0 && /*#__PURE__*/ _jsxs("div", {
                                        ref: conversationNavigatorRef,
                                        className: `conversation-navigator ${conversationNavOpen ? 'is-open' : ''}`,
                                        onPointerEnter: openConversationNavigator,
                                        onPointerLeave: ()=>scheduleConversationNavClose(),
                                        onFocusCapture: openConversationNavigator,
                                        onBlurCapture: (event)=>{
                                            const nextTarget = event.relatedTarget;
                                            if (!(nextTarget instanceof Node && event.currentTarget.contains(nextTarget))) scheduleConversationNavClose();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "conversation-nav-rail",
                                                role: "button",
                                                tabIndex: 0,
                                                "aria-label": "打开本次对话导航",
                                                "aria-expanded": conversationNavOpen,
                                                onClick: ()=>conversationNavOpen ? scheduleConversationNavClose(true) : openConversationNavigator(),
                                                onKeyDown: (event)=>{
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        conversationNavOpen ? scheduleConversationNavClose(true) : openConversationNavigator();
                                                    }
                                                },
                                                children: conversationItems.map((item)=>/*#__PURE__*/ _jsx("i", {}, item.id))
                                            }),
                                            !chatNearBottom && /*#__PURE__*/ _jsx("button", {
                                                type: "button",
                                                className: "conversation-nav-bottom",
                                                onClick: followChatToEnd,
                                                "data-tooltip": "跳到对话底部",
                                                "aria-label": "跳到对话底部",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "chevron",
                                                    size: 15
                                                })
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "conversation-nav-popover",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "conversation-nav-title",
                                                        children: [
                                                            "本次对话 \xb7 ",
                                                            conversationItems.length,
                                                            " 个提问"
                                                        ]
                                                    }),
                                                    conversationItems.map((item)=>/*#__PURE__*/ _jsx("button", {
                                                            type: "button",
                                                            onClick: ()=>{
                                                                jumpToMessage(item.id);
                                                                scheduleConversationNavClose(true);
                                                            },
                                                            title: item.text,
                                                            children: item.text
                                                        }, item.id))
                                                ]
                                     }),
                                 ]
                             })
                             ]
                              }),
                              section === 'angle' && /*#__PURE__*/ _jsx(AngleConsole, {
                                    }),
                                    /*#__PURE__*/ _jsx("div", {
                                        ref: agentComposerRef,
                                        className: "agent-composer-wrap",
                                        children: /*#__PURE__*/ _jsxs("div", {
                                            className: "agent-composer",
                                            children: [
                                                agentMessageSelectionMode && /*#__PURE__*/ _jsxs("div", {
                                                    className: "agent-message-selection-bar",
                                                    children: [
                                                        /*#__PURE__*/ _jsxs("span", {
                                                            children: [
                                                                "已选择 ",
                                                                /*#__PURE__*/ _jsx("b", {
                                                                    children: selectedAgentMessages.size
                                                                }),
                                                                " 条对话内容"
                                                            ]
                                                        }),
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            children: [
                                                                /*#__PURE__*/ _jsx("button", {
                                                                    type: "button",
                                                                    onClick: resetMessageSelection,
                                                                    children: "取消"
                                                                }),
                                                                /*#__PURE__*/ _jsxs("button", {
                                                                    type: "button",
                                                                    className: "danger",
                                                                    disabled: !selectedAgentMessages.size,
                                                                    onClick: ()=>void deleteSelectedAgentMessages(),
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx(Icon, {
                                                                            name: "trash",
                                                                            size: 14
                                                                        }),
                                                                        "删除所选"
                                                                    ]
                                                                })
                                                            ]
                                                        })
                                                    ]
                                                }),
                                                agentRefs.length > 0 && /*#__PURE__*/ _jsx(ReferenceStrip, {
                                                    refs: agentRefs,
                                                    onAdd: (files)=>void addReferences(files, 'agent'),
                                                    onRemove: (id)=>setAgentRefs((old)=>old.filter((x)=>x.id !== id)),
                                                    onReorder: (fromIndex, toIndex)=>setAgentRefs((old)=>reorderReferenceItems(old, fromIndex, toIndex)),
                                                    onClear: ()=>setAgentRefs([]),
                                                    label: "本轮参考图"
                                                }),
                                                agentFiles.length > 0 && /*#__PURE__*/ _jsx(ChatFileList, {
                                                    files: agentFiles,
                                                    onDownload: (file)=>{
                                                        void downloadChatFile(file).catch(()=>notify('文件下载失败'));
                                                    },
                                                    onRemove: (file)=>setAgentFiles((old)=>old.filter((item)=>item.id !== file.id))
                                                }),
                                                agentFollowUp && /*#__PURE__*/ _jsxs("div", {
                                                    className: "agent-followup-card",
                                                    children: [
                                                        /*#__PURE__*/ _jsx("span", {
                                                            className: "agent-followup-mark",
                                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                                name: "agent",
                                                                size: 14
                                                            })
                                                        }),
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            children: [
                                                                /*#__PURE__*/ _jsxs("small", {
                                                                    children: [
                                                                        "正在追问 ",
                                                                        agentFollowUp.role === 'assistant' ? '助手回复' : '你的消息'
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsx("strong", {
                                                                    title: agentFollowUp.content,
                                                                    children: agentFollowUp.content.replace(/\s+/g, ' ').trim()
                                                                })
                                                            ]
                                                        }),
                                                        /*#__PURE__*/ _jsx("button", {
                                                            type: "button",
                                                            title: "取消引用",
                                                            "aria-label": "取消引用",
                                                            onClick: ()=>setAgentFollowUp(null),
                                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                                name: "close",
                                                                size: 15
                                                            })
                                                        })
                                                    ]
                                                }),
                                                /*#__PURE__*/ _jsx("textarea", {
                                                    ref: agentInputRef,
                                                    value: agentInput,
                                                     readOnly: agentMessageSelectionActive || promptOptimizing,
                                                    onChange: (e)=>{
                                                        setAgentInput(e.target.value);
                                                        setAgentMentionOpen(mentionIsOpen(e.target.value, e.currentTarget.selectionStart, agentRefs));
                                                    },
                                                    onFocus: (e)=>setAgentMentionOpen(mentionIsOpen(e.currentTarget.value, e.currentTarget.selectionStart, agentRefs)),
                                                    onClick: (e)=>setAgentMentionOpen(mentionIsOpen(e.currentTarget.value, e.currentTarget.selectionStart, agentRefs)),
                                                    onKeyUp: (e)=>{
                                                        if (e.key !== 'Escape') setAgentMentionOpen(mentionIsOpen(e.currentTarget.value, e.currentTarget.selectionStart, agentRefs));
                                                    },
                                                    placeholder: "详细描述你想生成或修改的画面：主体外观与动作、场景环境、构图视角、光线色彩、风格材质、镜头感和需要避免的内容；也可以上传参考图让助手分析。",
                                                    onPaste: (e)=>{
                                                        const files = Array.from(e.clipboardData.files || []);
                                                        if (files.some((f)=>f.type.startsWith('image/'))) {
                                                            e.preventDefault();
                                                            void addReferences(files, 'agent');
                                                        }
                                                    },
                                                    onKeyDown: (e)=>{
                                                        if (e.key === 'Escape') setAgentMentionOpen(false);
                                                        if (e.key === 'Enter' && !e.shiftKey) {
                                                            e.preventDefault();
                                                            if (!activeAgentBusy) void sendAgent();
                                                        }
                                                    }
                                                }),
                                                /*#__PURE__*/ _jsx(ReferenceMentionMenu, {
                                                    refs: agentRefs,
                                                    open: agentMentionOpen,
                                                    className: "agent-mention-menu",
                                                    onSelect: (index)=>insertReferenceMention(agentInput, setAgentInput, setAgentMentionOpen, agentInputRef, index)
                                                }),
                                                agentInput && !agentMessageSelectionActive && !promptOptimizing && /*#__PURE__*/ _jsx("button", {
                                                    type: "button",
                                                    className: "agent-input-clear",
                                                    title: "清空输入内容",
                                                    onClick: ()=>setAgentInput(''),
                                                    children: "清空"
                                                }),
                                                /*#__PURE__*/ _jsxs("div", {
                                                    className: "composer-footer",
                                                    children: [
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            className: "composer-left",
                                                            children: [
                                                                /*#__PURE__*/ _jsxs("label", {
                                                                    className: "icon-upload",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("input", {
                                                                            type: "file",
                                                                            hidden: true,
                                                                            accept: "image/png,image/jpeg,image/webp,.txt,.md,.markdown,.json,.csv,.tsv,.html,.htm,.css,.js,.jsx,.ts,.tsx,.py,.java,.sql,.xml,.svg,.yaml,.yml,.sh,.ps1",
                                                                            multiple: true,
                                                                            onChange: (e)=>{
                                                                                if (e.target.files) void addAgentAttachments(e.target.files);
                                                                                e.currentTarget.value = '';
                                                                            }
                                                                        }),
                                                                        /*#__PURE__*/ _jsx(Icon, {
                                                                            name: "upload",
                                                                            size: 16
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: "图片 / 文件"
                                                                        })
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsx(ModelPicker, {
                                                                    models: availableChatModels,
                                                                    value: activeAgentModelId,
                                                                    capability: "chat",
                                                                    defaultProviderId: state.settings.defaultProviderId,
                                                                    defaultProviderName: defaultProvider?.name,
                                                                    defaultModelId: state.settings.agentModelId,
                                                                    onChange: setAgentModelId,
                                                                    className: "model-dropdown compact"
                                                                }),
                                                                /*#__PURE__*/ _jsxs("div", {
                                                                    className: "agent-web-toggle-wrap",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: `agent-web-mode-trigger ${agentWebMode}`,
                                                                            onClick: ()=>setAgentWebModeMenuOpen((open)=>!open),
                                                                            "aria-describedby": "agent-web-toggle-tip",
                                                                            "aria-label": "联网模式",
                                                                            "aria-expanded": agentWebModeMenuOpen,
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx(Icon, { name: "globe", size: 14 }),
                                                                                /*#__PURE__*/ _jsx("span", { children: `联网：${agentWebMode === 'auto' ? '智能' : agentWebMode === 'always' ? '始终' : '关闭'}` }),
                                                                                /*#__PURE__*/ _jsx(Icon, { name: "down", size: 13 })
                                                                            ]
                                                                        }),
                                                                        agentWebModeMenuOpen && /*#__PURE__*/ _jsx("div", {
                                                                            className: "agent-web-mode-menu",
                                                                            role: "menu",
                                                                            children: [
                                                                                 ['auto', '智能联网', nativeWebSearchModelActive ? '需要最新事实时优先使用模型原生搜索，失败回退外部 API' : '仅在需要最新或外部事实时使用外部搜索 API'],
                                                                                 ['always', '始终联网', nativeWebSearchModelActive ? '每轮优先使用模型原生搜索，失败回退外部 API' : '每轮使用外部搜索 API，回复可能较慢'],
                                                                                ['off', '关闭联网', '最快的纯模型回复']
                                                                            ].map(([mode, label, description])=>/*#__PURE__*/ _jsxs("button", {
                                                                                type: "button",
                                                                                role: "menuitemradio",
                                                                                "aria-checked": agentWebMode === mode,
                                                                                className: agentWebMode === mode ? 'active' : '',
                                                                                onClick: ()=>{
                                                                                    setAgentWebModePreference(mode);
                                                                                    setAgentWebModeMenuOpen(false);
                                                                                },
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("strong", { children: label }),
                                                                                    /*#__PURE__*/ _jsx("small", { children: description })
                                                                                ]
                                                                            }, mode))
                                                                        }),
                                                                         !agentWebModeMenuOpen && /*#__PURE__*/ _jsx("span", {
                                                                             id: "agent-web-toggle-tip",
                                                                             className: "agent-web-tooltip",
                                                                             role: "tooltip",
                                                                             children: `${agentWebMode === 'auto' ? '仅在需要最新或外部事实时搜索，普通创作会立即回复。' : agentWebMode === 'always' ? '每轮都会联网检索，回复可能较慢。' : '不会联网，适合最快的纯模型回复。'} ${nativeWebSearchHint}`
                                                                         }),
                                                                         /*#__PURE__*/ _jsx("span", {
                                                                             className: `agent-native-search-hint ${nativeWebSearchModelActive ? 'active' : ''}`,
                                                                             title: nativeWebSearchHint,
                                                                             children: nativeWebSearchModelActive ? '模型自带搜索 · 优先使用' : '外部搜索 API'
                                                                         })
                                                                     ]
                                                                }),
                                                                (agentRefs.length > 0 || agentInput.trim()) && /*#__PURE__*/ _jsxs("div", {
                                                                    className: "agent-quick-actions",
                                                                    children: [
                                                                        agentRefs.length > 0 && /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: `agent-quick-button ${agentRefs.length > 1 ? 'one-take' : 'reverse'}`,
                                                                             disabled: activeAgentBusy || agentMessageSelectionActive || agentRefs.some((ref)=>ref.pending),
                                                                            onClick: ()=>void reversePromptFromReferences(),
                                                                            "data-tooltip": agentRefs.some((ref)=>ref.pending) ? '参考图准备完成后才能生成' : agentRefs.length > 1 ? '按参考图顺序生成 15 秒一镜到底视频 Prompt' : '根据已上传参考图反推提示词并自动提交',
                                                                            "aria-label": agentRefs.some((ref)=>ref.pending) ? '参考图准备完成后才能生成' : agentRefs.length > 1 ? '按参考图顺序生成 15 秒一镜到底视频 Prompt' : '根据已上传参考图反推提示词并自动提交',
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                                    name: agentRefs.length > 1 ? "video" : "image",
                                                                                    size: 14
                                                                                }),
                                                                                agentRefs.length > 1 ? "一镜到底" : "反推提示词"
                                                                            ]
                                                                        }),
                                                                        agentInput.trim() && /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: "agent-quick-button optimize",
                                                                             disabled: promptOptimizing || activeAgentBusy || agentMessageSelectionActive,
                                                                            onClick: ()=>void optimizeAgentPrompt(),
                                                                            "data-tooltip": "润色并细写输入框中的文案，不会自动发送",
                                                                            "aria-label": "润色并细写输入框中的文案，不会自动发送",
                                                                            children: [
                                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                                    name: "agent",
                                                                                    size: 14
                                                                                }),
                                                                                promptOptimizing ? 'AI 优化中…' : 'AI 优化'
                                                                            ]
                                                                        })
                                                                    ]
                                                                })
                                                            ]
                                                        }),
                                                        /*#__PURE__*/ _jsx("button", {
                                                            type: "button",
                                                            className: `send-button ${activeAgentBusy ? 'stop-button' : ''}`,
                                                            disabled: activeAgentBusy ? false : !agentInput.trim() && !agentFiles.length && !agentRefs.length || agentMessageSelectionActive || agentRefs.some((ref)=>ref.pending),
                                                            onClick: ()=>activeAgentBusy ? void stopAgent() : void sendAgent(),
                                                            title: activeAgentBusy ? '停止当前回答' : agentMessageSelectionMode ? '请先完成或取消删除选择' : shareSelectionMode ? '请先完成或取消分享选择' : agentRefs.some((ref)=>ref.pending) ? '参考图准备完成后才能发送' : '发送',
                                                            "aria-label": activeAgentBusy ? '停止当前回答' : '发送',
                                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                                name: activeAgentBusy ? "stop" : "send",
                                                                size: 18
                                                            })
                                                        })
                                                    ]
                                                })
                                            ]
                                        })
                                    })
                                ]
                            }),
                            section === 'angle' && /*#__PURE__*/ _jsx(AngleConsole, {
                                theme: theme,
                                reference: angleReference,
                                initialCamera: angleCameraSeed,
                                initialCameraStart: angleCameraStartSeed,
                                models: availableGenerationModels,
                                defaultProviderId: state.settings.defaultProviderId,
                                defaultProviderName: defaultProvider?.name,
                                defaultModelId: state.settings.defaultImageModelId,
                                results: angleResults,
                                busy: angleBusy,
                                openResultId: angleResultOpenRequest,
                                suppressAutoOpenId: angleSuppressAutoOpenId,
                                onResultOpened: (id)=>{
                                    markHistoryNoticeSeen();
                                    setAngleResultOpenRequest(null);
                                    setAngleResultToast((current)=>current?.id === id ? null : current);
                                },
                                onReferenceFiles: (files)=>{
                                    void addReferences(files, 'angle');
                                },
                                onExit: ()=>{
                                    setAngleSuppressAutoOpenId(null);
                                    setSection(lastNonAngleSectionRef.current);
                                },
                                onRemoveReference: ()=>{
                                    setAngleReference(null);
                                    setAngleCameraSeed(null);
                                    setAngleCameraStartSeed(null);
                                    setAngleResults([]);
                                    setAngleSuppressAutoOpenId(null);
                                },
                                onBrowseHistory: ()=>{ setRecordTab('works'); setSection('history'); },
                                onGenerate: submitAngleGeneration,
                                onOpenResult: (item)=>openViewer(item),
                                onUseResult: openAngleConsole,
                                onDownloadResult: (item)=>downloadUrl(item.url, `SANMAO-${item.id}.png`),
                                onDownloadShare: (item)=>downloadShareImage(item).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                onNotify: notify
                            }),
                            section === 'video' && /*#__PURE__*/ _jsx(VideoStudio, {
                                models: availableVideoModels,
                                providers: state.providers,
                                defaultModelId: state.settings.defaultVideoModelId,
                                promptPrefill: videoPromptPrefill,
                                onPromptPrefillConsumed: ()=>setVideoPromptPrefill(null),
                                mediaPrefill: videoMediaPrefill,
                                mediaPrefillToken: videoMediaPrefillToken,
                                onMediaPrefillConsumed: ()=>setVideoMediaPrefill(null),
                                onOpenModels: ()=>setSection('models'),
                                onOpenProviders: ()=>setSection('providers'),
                                onNotify: notify
                            }),
                            section === 'generate' && /*#__PURE__*/ _jsxs("section", {
                                className: "generate-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("form", {
                                        className: `generate-panel surface ${generateUpscaleMode ? 'upscale-mode' : ''}`,
                                        onSubmit: submitGenerate,
                                        onPaste: (e)=>{
                                            const files = clipboardImageFiles(e.clipboardData);
                                            if (files.length) {
                                                e.preventDefault();
                                                void addReferences(files, 'generate');
                                                notify(`已从剪贴板添加 ${files.length} 张参考图`);
                                            }
                                        },
                                        onDragOver: (e)=>e.preventDefault(),
                                        onDrop: (e)=>{
                                            e.preventDefault();
                                            if (e.dataTransfer.files?.length) void addReferences(e.dataTransfer.files, 'generate');
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "panel-title",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "创作设置"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "添加参考图时会自动尝试图片编辑/参考图接口"
                                                            })
                                                        ]
                                                    }),
                                                    generateUpscaleMode ? /*#__PURE__*/ _jsx("span", {
                                                        className: "mode-badge",
                                                        children: "图片超分"
                                                    }) : generateRefs.length ? /*#__PURE__*/ _jsx("span", {
                                                        className: "mode-badge",
                                                        children: "参考图模式"
                                                    }) : /*#__PURE__*/ _jsx("span", {
                                                        className: "mode-badge neutral",
                                                        children: "文本生图"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("label", {
                                                className: "field-block prompt-field",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "prompt-field-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "prompt-field-label",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: generateUpscaleMode ? '可选说明' : '提示词'
                                                                    }),
                                                                    !generateUpscaleMode && generatePromptBeforeOptimization !== null && /*#__PURE__*/ _jsx("small", {
                                                                        children: "已保留原文"
                                                                    })
                                                                ]
                                                            }),
                                                            !generateUpscaleMode && /*#__PURE__*/ _jsxs("div", {
                                                                className: "prompt-field-actions",
                                                                children: [
                                                                    generatePromptBeforeOptimization !== null && /*#__PURE__*/ _jsx("button", {
                                                                        type: "button",
                                                                        className: "prompt-undo",
                                                                        onClick: undoGeneratePromptOptimization,
                                                                        children: "撤销"
                                                                    }),
                                                                    generatePrompt.trim() && /*#__PURE__*/ _jsxs("button", {
                                                                        type: "button",
                                                                        className: "prompt-optimize",
                                                                        "aria-busy": generatePromptOptimizing,
                                                                        disabled: generatePromptOptimizing || generateRefs.some((reference)=>reference.pending),
                                                                        onClick: ()=>void optimizeGeneratePrompt(),
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                                name: "agent",
                                                                                size: 13
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("span", {
                                                                                children: generatePromptOptimizing ? '优化中…' : 'AI 优化'
                                                                            })
                                                                        ]
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("textarea", {
                                                        ref: generatePromptRef,
                                                        readOnly: generatePromptOptimizing,
                                                        value: generatePrompt,
                                                        onChange: (e)=>{
                                                            setGeneratePrompt(e.target.value);
                                                            setGeneratePromptBeforeOptimization(null);
                                                            setGenerateMentionOpen(mentionIsOpen(e.target.value, e.currentTarget.selectionStart, generateRefs));
                                                        },
                                                        onFocus: (e)=>setGenerateMentionOpen(mentionIsOpen(e.target.value, e.currentTarget.selectionStart, generateRefs)),
                                                        onClick: (e)=>setGenerateMentionOpen(mentionIsOpen(e.currentTarget.value, e.currentTarget.selectionStart, generateRefs)),
                                                        onKeyUp: (e)=>{
                                                            if (e.key !== 'Escape') setGenerateMentionOpen(mentionIsOpen(e.currentTarget.value, e.currentTarget.selectionStart, generateRefs));
                                                        },
                                                        onKeyDown: (e)=>{
                                                            if (e.key === 'Escape') setGenerateMentionOpen(false);
                                                        },
                                                        placeholder: generateUpscaleMode ? 'SeedVR2 超分不会根据提示词修改画面…' : '详细描述主体、场景、构图、光线、风格和需要避免的内容…'
                                                    }),
                                                    /*#__PURE__*/ _jsx(ReferenceMentionMenu, {
                                                        refs: generateRefs,
                                                        open: generateMentionOpen,
                                                        className: "generate-mention-menu",
                                                        onSelect: (index)=>insertReferenceMention(generatePrompt, setGeneratePrompt, setGenerateMentionOpen, generatePromptRef, index)
                                                    }),
                                                    generatePrompt && /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "prompt-clear",
                                                        title: "清空提示词",
                                                        onClick: ()=>{
                                                            setGeneratePrompt('');
                                                            setGeneratePromptBeforeOptimization(null);
                                                        },
                                                        children: "清空"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx(ReferenceStrip, {
                                                refs: generateRefs,
                                                onAdd: (files)=>void addReferences(files, 'generate'),
                                                onPasteClick: ()=>void pasteClipboardImages('generate'),
                                                onLocalUpscale: toggleLocalUpscaleMode,
                                                localUpscaleActive: generateUpscaleMode,
                                                onRemove: (id)=>{
                                                    setGenerateRefs((old)=>old.filter((x)=>x.id !== id));
                                                    if (generateMask?.referenceId === id) setGenerateMask(null);
                                                },
                                                onReorder: (fromIndex, toIndex)=>setGenerateRefs((old)=>reorderReferenceItems(old, fromIndex, toIndex)),
                                                onClear: ()=>{
                                                    setGenerateRefs([]);
                                                    setGenerateMask(null);
                                                }
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "reference-tools",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        type: "button",
                                                        className: `ghost-button mask-button ${generateMask ? 'active' : ''}`,
                                                        disabled: generateRefs.length !== 1 || generateRefs.some((ref)=>ref.pending),
                                                        title: generateRefs.some((ref)=>ref.pending) ? '参考图准备完成后才能绘制蒙版' : generateRefs.length > 1 ? '绘制蒙版仅支持上传 1 张参考图' : undefined,
                                                        onClick: ()=>generateRefs.length === 1 && !generateRefs[0]?.pending ? setMaskEditorOpen(true) : notify(generateRefs.length > 1 ? '绘制蒙版仅支持上传 1 张参考图' : '参考图正在准备，请稍候片刻'),
                                                        children: [
                                                            "▧ ",
                                                            generateMask ? '蒙版已设置' : '绘制蒙版',
                                                            generateMask && /*#__PURE__*/ _jsx("i", {})
                                                        ]
                                                    }),
                                                    generateMask && /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "mask-remove",
                                                        onClick: ()=>{
                                                            setGenerateMask(null);
                                                            notify('蒙版已移除');
                                                        },
                                                        children: "移除"
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        className: generateRefs.length > 1 ? 'mask-hint warning' : '',
                                                        children: generateRefs.some((ref)=>ref.pending) ? '参考图正在准备，完成后即可提交' : generateRefs.length > 1 ? '绘制蒙版仅支持 1 张参考图' : generateMask ? '红色区域会重新绘制' : '可选：指定只修改参考图的局部区域'
                                                    })
                                                ]
                                            }),
                                            generateUpscaleMode && /*#__PURE__*/ _jsxs("div", {
                                                className: "upscale-workbench",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "upscale-workbench-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("strong", {
                                                                children: "图片超分参数"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: `${selectedUpscaleModel?.displayName || '超分模型'} 将使用第一张本地图片作为输入。`
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-grid upscale-settings-grid",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "模型"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx(ModelPicker, {
                                                                        models: availableUpscaleModels,
                                                                        value: generateUpscaleModelId,
                                                                        capability: "upscale",
                                                                        defaultProviderId: state.settings.defaultProviderId,
                                                                        defaultProviderName: defaultProvider?.name,
                                                                        onChange: handleUpscaleModelChange
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "放大倍率"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                                        value: String(generateUpscaleScale),
                                                                        options: (selectedUpscaleModel?.scales || upscaleScales).map((scale)=>({
                                                                                value: String(scale),
                                                                                label: `${scale}×`
                                                                            })),
                                                                        onChange: (value)=>{
                                                                            setGenerateUpscaleScale(Number(value));
                                                                            setGenerateUpscaleTarget('auto');
                                                                        }
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "目标尺寸"
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        className: "upscale-target-readout",
                                                                        children: [
                                                                            /*#__PURE__*/ _jsxs("small", {
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("i", {
                                                                                        children: "原图"
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("b", {
                                                                                        children: generateUpscaleSourceSize ? `${generateUpscaleSourceSize.width}×${generateUpscaleSourceSize.height}` : '读取中…'
                                                                                    })
                                                                                ]
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("em", {
                                                                                children: "→"
                                                                            }),
                                                                            /*#__PURE__*/ _jsxs("strong", {
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("i", {
                                                                        children: "输出"
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("b", {
                                                                                        children: generateUpscaleTargetPreview ? `${generateUpscaleTargetPreview.width}×${generateUpscaleTargetPreview.height}` : '计算中…'
                                                                                    })
                                                                                ]
                                                                            })
                                                                        ]
                                                                    })
                                                                ]
                                                            }),
                                                            !selectedUpscaleIsCloud && /*#__PURE__*/ _jsxs("label", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "随机种子"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("input", {
                                                                        type: "number",
                                                                        min: "0",
                                                                        max: "2147483647",
                                                                        value: generateUpscaleSeed,
                                                                        onChange: (e)=>setGenerateUpscaleSeed(Math.max(0, Number(e.target.value) || 0))
                                                                    })
                                                                ]
                                                            }),
                                                            !selectedUpscaleIsCloud && /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "颜色校正"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                                        value: generateUpscaleColorCorrection,
                                                                        options: [
                                                                            {
                                                                                value: 'wavelet',
                                                                                label: 'wavelet · 接近原图'
                                                                            },
                                                                            {
                                                                                value: 'none',
                                                                                label: '关闭'
                                                                            }
                                                                        ],
                                                                        onChange: (value)=>setGenerateUpscaleColorCorrection(value)
                                                                    })
                                                                ]
                                                            }),
                                                            !selectedUpscaleIsCloud && /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "缩放算法"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                                        value: generateUpscaleAlgorithm,
                                                                        options: [
                                                                            {
                                                                                value: 'lanczos',
                                                                                label: 'lanczos · 锐利'
                                                                            },
                                                                            {
                                                                                value: 'bicubic',
                                                                                label: 'bicubic · 平滑'
                                                                            },
                                                                            {
                                                                                value: 'nearest',
                                                                                label: 'nearest · 像素'
                                                                            }
                                                                        ],
                                                                        onChange: (value)=>setGenerateUpscaleAlgorithm(value)
                                                                    })
                                                                ]
                                                            }),
                                                            selectedUpscaleOption?.outputFormats && /*#__PURE__*/ _jsxs("div", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "输出格式"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                                        value: generateUpscaleOutputFormat,
                                                                        options: cloudUpscaleFormatOptions.filter((option)=>selectedUpscaleOption.outputFormats.includes(option.value)),
                                                                        onChange: (value)=>setGenerateUpscaleOutputFormat(value)
                                                                    })
                                                                ]
                                                            }),
                                                            selectedUpscaleOption?.outputQuality && generateUpscaleOutputFormat === 'jpg' && /*#__PURE__*/ _jsxs("label", {
                                                                className: "field-block",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "JPG 质量"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("input", {
                                                                        type: "number",
                                                                        min: selectedUpscaleOption.outputQuality.min,
                                                                        max: selectedUpscaleOption.outputQuality.max,
                                                                        step: "1",
                                                                        value: generateUpscaleOutputQuality,
                                                                        onChange: (e)=>setGenerateUpscaleOutputQuality(Math.max(selectedUpscaleOption.outputQuality.min, Math.min(selectedUpscaleOption.outputQuality.max, Number(e.target.value) || selectedUpscaleOption.outputQuality.default)))
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "upscale-reference-note",
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "image",
                                                                size: 15
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: generateRefs.length ? '已上传本地图片；超分时使用第 1 张参考图。' : '请先在上方上传一张本地图片。'
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: `settings-grid generate-primary-settings ${generateAdvancedOpen ? 'advanced-open' : 'advanced-closed'}`,
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "field-block",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "图片模型"
                                                            }),
                                                            /*#__PURE__*/ _jsx(ModelPicker, {
                                                                models: availableGenerationModels,
                                                                value: generateModelId,
                                                                capability: "generate",
                                                                defaultProviderId: state.settings.defaultProviderId,
                                                                defaultProviderName: defaultProvider?.name,
                                                                defaultModelId: state.settings.defaultImageModelId,
                                                                onChange: setGenerateModelId
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "field-block",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "质量"
                                                            }),
                                                            /*#__PURE__*/ _jsx(Dropdown, {
                                                                value: quality,
                                                                options: qualityOptions,
                                                                onChange: (v)=>setQuality(v)
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "field-block",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "出图格式"
                                                            }),
                                                            /*#__PURE__*/ _jsx(Dropdown, {
                                                                value: outputFormat,
                                                                options: [
                                                                    {
                                                                        value: 'png',
                                                                        label: 'PNG · 无损'
                                                                    },
                                                                    {
                                                                        value: 'jpeg',
                                                                        label: 'JPEG · 体积更小'
                                                                    },
                                                                    {
                                                                        value: 'webp',
                                                                        label: 'WebP · 适合网页'
                                                                    }
                                                                ],
                                                                onChange: (v)=>setOutputFormat(v)
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "field-block",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "背景限制"
                                                            }),
                                                            /*#__PURE__*/ _jsx(Dropdown, {
                                                                value: backgroundMode,
                                                                options: [
                                                                    {
                                                                        value: 'auto',
                                                                        label: '自动'
                                                                    },
                                                                    {
                                                                        value: 'api-transparent',
                                                                        label: 'API 透明',
                                                                        meta: '不支持 Image 2 系列'
                                                                    },
                                                                    {
                                                                        value: 'local-transparent',
                                                                        label: '本地透明',
                                                                        meta: '自动去白底，输出 PNG'
                                                                    },
                                                                    {
                                                                        value: 'opaque',
                                                                        label: '不透明'
                                                                    }
                                                                ],
                                                                onChange: (v)=>{
                                                                    const next = v;
                                                                    setBackgroundMode(next);
                                                                    if (next === 'api-transparent' || next === 'local-transparent') setOutputFormat('png');
                                                                }
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                type: "button",
                                                className: `advanced-settings-toggle ${generateAdvancedOpen ? 'active' : ''}`,
                                                "aria-expanded": generateAdvancedOpen,
                                                onClick: ()=>setGenerateAdvancedOpen((value)=>!value),
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: generateAdvancedOpen ? '收起更多参数' : '更多参数'
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: generateAdvancedOpen ? '质量、格式、背景限制' : '质量、格式、背景限制'
                                                    }),
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "chevron",
                                                        size: 14
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "field-block resolution-field",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "尺寸与分辨率"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        ref: sizeTabsRef,
                                                        className: "size-mode-tabs",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("button", {
                                                                type: "button",
                                                                className: sizeDrawer === 'ratio' ? 'active' : '',
                                                                onClick: ()=>{
                                                                    const rect = sizeTabsRef.current?.getBoundingClientRect();
                                                                    if (rect) setSizeMenuStyle({
                                                                        left: rect.left,
                                                                        width: rect.width,
                                                                        bottom: Math.max(8, window.innerHeight - rect.top + 6)
                                                                    });
                                                                    setSizeDrawer(sizeDrawer === 'ratio' ? null : 'ratio');
                                                                },
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                        children: "比例"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("small", {
                                                                        children: selectedRatioLabel
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("button", {
                                                                type: "button",
                                                                className: sizeDrawer === 'resolution' ? 'active' : '',
                                                                onClick: ()=>{
                                                                    const rect = sizeTabsRef.current?.getBoundingClientRect();
                                                                    if (rect) setSizeMenuStyle({
                                                                        left: rect.left,
                                                                        width: rect.width,
                                                                        bottom: Math.max(8, window.innerHeight - rect.top + 6)
                                                                    });
                                                                    setSizeDrawer(sizeDrawer === 'resolution' ? null : 'resolution');
                                                                },
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                        children: "分辨率"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("small", {
                                                                        children: sizeMode === 'custom' ? `${customWidth}×${customHeight}` : sizeTier.toUpperCase()
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            sizeDrawer && /*#__PURE__*/ _jsx("div", {
                                                className: "size-drawer-backdrop",
                                                style: sizeMenuStyle,
                                                children: /*#__PURE__*/ _jsxs("div", {
                                                    className: "size-drawer",
                                                    onClick: (e)=>e.stopPropagation(),
                                                    children: [
                                                        /*#__PURE__*/ _jsxs("div", {
                                                            className: "size-drawer-head",
                                                            children: [
                                                                /*#__PURE__*/ _jsxs("div", {
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: sizeDrawer === 'ratio' ? '画布比例' : '输出分辨率'
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("strong", {
                                                                            children: sizeDrawer === 'ratio' ? selectedRatioLabel : sizeMode === 'custom' ? `${customWidth}×${customHeight}` : sizeTier.toUpperCase()
                                                                        })
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsx("button", {
                                                                    type: "button",
                                                                    className: "icon-button",
                                                                    onClick: ()=>setSizeDrawer(null),
                                                                    children: /*#__PURE__*/ _jsx(Icon, {
                                                                        name: "close",
                                                                        size: 16
                                                                    })
                                                                })
                                                            ]
                                                        }),
                                                        sizeDrawer === 'ratio' ? /*#__PURE__*/ _jsxs("div", {
                                                            className: "dimension-ratios drawer-options",
                                                            children: [
                                                                /*#__PURE__*/ _jsx("span", {
                                                                    children: "选择比例"
                                                                }),
                                                                ratios.map((item)=>/*#__PURE__*/ _jsxs("button", {
                                                                        type: "button",
                                                                        className: ratio === item ? 'active' : '',
                                                                        onClick: ()=>{
                                                                            setRatio(item);
                                                                            setSizeMode('system');
                                                                            if (item !== '自定义') setSizeDrawer(null);
                                                                        },
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("strong", {
                                                                                children: item === '自动' && effectiveAutoRatio !== '自动' ? `自动 · ${effectiveAutoRatio}` : item
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("small", {
                                                                                children: item === '自动' && effectiveAutoRatio !== '自动' ? '按第 1 张参考图匹配' : ratioDescriptions[item] || '模型自选'
                                                                            })
                                                                        ]
                                                                    }, item)),
                                                                ratio === '自定义' && /*#__PURE__*/ _jsxs("div", {
                                                                    className: "custom-ratio-card drawer-custom-size",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsxs("div", {
                                                                            className: "custom-size-row",
                                                                            children: [
                                                                                /*#__PURE__*/ _jsxs("label", {
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("span", {
                                                                                            children: "比例宽"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsx("input", {
                                                                                            type: "number",
                                                                                            min: "1",
                                                                                            value: customRatioWidth,
                                                                                            inputMode: "numeric",
                                                                                            onChange: (e)=>setCustomRatioWidth(Math.max(1, Number(e.target.value) || 1))
                                                                                        })
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("b", {
                                                                                    children: ":"
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("label", {
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("span", {
                                                                                            children: "比例高"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsx("input", {
                                                                                            type: "number",
                                                                                            min: "1",
                                                                                            value: customRatioHeight,
                                                                                            inputMode: "numeric",
                                                                                            onChange: (e)=>setCustomRatioHeight(Math.max(1, Number(e.target.value) || 1))
                                                                                        })
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("small", {
                                                                                    children: "1K / 2K / 4K 会按此比例自动计算尺寸。"
                                                                                })
                                                                            ]
                                                                        }),
                                                                        /*#__PURE__*/ _jsxs("button", {
                                                                            type: "button",
                                                                            className: "primary-small custom-size-confirm",
                                                                            onClick: ()=>{
                                                                                setSizeMode('system');
                                                                                setSizeDrawer(null);
                                                                            },
                                                                            children: [
                                                                                "使用 ",
                                                                                customRatioWidth,
                                                                                ":",
                                                                                customRatioHeight
                                                                            ]
                                                                        })
                                                                    ]
                                                                })
                                                            ]
                                                        }) : /*#__PURE__*/ _jsxs("div", {
                                                            className: "resolution-drawer-content",
                                                            children: [
                                                                /*#__PURE__*/ _jsxs("div", {
                                                                    className: "resolution-tiers drawer-options",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsx("span", {
                                                                            children: "预设分辨率"
                                                                        }),
                                                                        sizeTiers.map((item)=>{
                                                                            const resolvedRatio = ratio === '自动' ? effectiveAutoRatio : ratio;
                                                                            const dimensions = presetDimensions(resolvedRatio, item.value, customRatioWidth, customRatioHeight);
                                                                            return /*#__PURE__*/ _jsxs("button", {
                                                                                type: "button",
                                                                                className: sizeMode === 'system' && sizeTier === item.value ? 'active' : '',
                                                                                onClick: ()=>{
                                                                                    setSizeTier(item.value);
                                                                                    setSizeMode('system');
                                                                                    setSizeDrawer(null);
                                                                                },
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                                        children: item.label
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("small", {
                                                                                        children: resolvedRatio === '自动' ? `自动比例 · 长边约 ${item.longEdge}` : `${dimensions.width}×${dimensions.height}`
                                                                                    })
                                                                                ]
                                                                            }, item.value);
                                                                        })
                                                                    ]
                                                                }),
                                                                /*#__PURE__*/ _jsxs("div", {
                                                                    className: "custom-size-card drawer-custom-size",
                                                                    children: [
                                                                        /*#__PURE__*/ _jsxs("div", {
                                                                            className: "custom-size-row",
                                                                            children: [
                                                                                /*#__PURE__*/ _jsxs("label", {
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("span", {
                                                                                            children: "宽度（px）"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsx("input", {
                                                                                            type: "number",
                                                                                            min: "1",
                                                                                            value: customWidth,
                                                                                            inputMode: "numeric",
                                                                                            onChange: (e)=>setCustomWidth(Number(e.target.value) || 0)
                                                                                        })
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("b", {
                                                                                    children: "\xd7"
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("label", {
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("span", {
                                                                                            children: "高度（px）"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsx("input", {
                                                                                            type: "number",
                                                                                            min: "1",
                                                                                            value: customHeight,
                                                                                            inputMode: "numeric",
                                                                                            onChange: (e)=>setCustomHeight(Number(e.target.value) || 0)
                                                                                        })
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsx("small", {
                                                                                    children: "可输入任意正整数尺寸，不再限制固定倍数。"
                                                                                })
                                                                            ]
                                                                        }),
                                                                        /*#__PURE__*/ _jsx("button", {
                                                                            type: "button",
                                                                            className: "primary-small custom-size-confirm",
                                                                            disabled: customWidth < 1 || customHeight < 1,
                                                                            onClick: ()=>{
                                                                                setSizeMode('custom');
                                                                                setSizeDrawer(null);
                                                                            },
                                                                            children: "使用自定义尺寸"
                                                                        })
                                                                    ]
                                                                })
                                                            ]
                                                        })
                                                    ]
                                                })
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "count-row",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "生成数量"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "一次最多 8 张，并行生成，哪张先完成就先显示"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "stepper",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                onClick: ()=>setCount((v)=>Math.max(1, v - 1)),
                                                                children: "−"
                                                            }),
                                                            /*#__PURE__*/ _jsx("strong", {
                                                                children: count
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                onClick: ()=>setCount((v)=>Math.min(8, v + 1)),
                                                                children: "＋"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "generate-submit-sticky",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "primary-action",
                                                        disabled: !generateUpscaleMode && !generatePrompt.trim() || !availableImageModels.length || generateRefs.some((ref)=>ref.pending),
                                                        children: generateBusy ? /*#__PURE__*/ _jsxs(_Fragment, {
                                                            children: [
                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "plus",
                                                                    size: 17
                                                                }),
                                                                "继续生成 \xb7 ",
                                                                activeGenerateTasks.length,
                                                                " 个进行中"
                                                            ]
                                                        }) : /*#__PURE__*/ _jsxs(_Fragment, {
                                                            children: [
                                                                /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "image",
                                                                    size: 17
                                                                }),
                                                                generateRefs.some((ref)=>ref.pending) ? '参考图准备中…' : generateUpscaleMode ? `开始 ${generateUpscaleScale}× 超分` : generateRefs.length ? '基于参考图生成' : '开始生成'
                                                            ]
                                                        })
                                                    }),
                                                    generateBusy ? /*#__PURE__*/ _jsx("small", {
                                                        className: "generate-timing active",
                                                        children: "无需等待，可继续修改参数并提交下一轮"
                                                    }) : generateRefs.some((ref)=>ref.pending) ? /*#__PURE__*/ _jsx("small", {
                                                        className: "generate-timing active",
                                                        children: "图片已显示，正在完成提交前的格式准备"
                                                    }) : lastGenerateInfo && /*#__PURE__*/ _jsx("small", {
                                                        className: "generate-timing",
                                                        children: lastGenerateInfo
                                                    }),
                                                    !availableImageModels.length && /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "inline-link",
                                                        onClick: ()=>setSection('models'),
                                                        children: "还没有图片模型，去模型库选择 →"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("section", {
                                        className: "result-panel surface",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "panel-title",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "本轮结果"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: generateTasks.length ? `${generateTasks.length} 轮任务 · ${activeGenerateTasks.length} 个进行中 · 结果按轮次分组` : lastGenerateInfo || '生成后会自动保存到“创作记录”'
                                                            })
                                                        ]
                                                    }),
                                                    (resultItems.length > 0 || generateTasks.length > 0) && /*#__PURE__*/ _jsxs("div", {
                                                        className: "panel-title-actions",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                onClick: ()=>{
                                                                    setGenerateTasks([]);
                                                                    setResultItems([]);
                                                                    setLastGenerateInfo('');
                                                                },
                                                                children: "清空本轮"
                                                            }),
                                                            /*#__PURE__*/ _jsxs("button", {
                                                                className: "ghost-button",
                                                                onClick: ()=>{ setRecordTab('works'); setSection('history'); },
                                                                children: [
                                                                    /*#__PURE__*/ _jsx(Icon, {
                                                                        name: "history",
                                                                        size: 15
                                                                    }),
                                                                    "查看全部历史"
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            generateTasks.length ? /*#__PURE__*/ _jsx("div", {
                                                className: "generation-task-list",
                                                children: generateTasks.map((task, index)=>/*#__PURE__*/ _jsxs("section", {
                                                        className: `generation-task-group ${task.status} tone-${index % 6}`,
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("header", {
                                                                className: "generation-task-head",
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        children: [
                                                                            /*#__PURE__*/ _jsxs("b", {
                                                                                children: [
                                                                                    "第 ",
                                                                                    generateTasks.length - index,
                                                                                    " 轮"
                                                                                ]
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("strong", {
                                                                                children: task.prompt
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("small", {
                                                                                children: task.info
                                                                            })
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("span", {
                                                                                className: `generation-task-status ${task.status}`,
                                                                                children: task.status === 'pending' ? /*#__PURE__*/ _jsxs(_Fragment, {
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("i", {
                                                                                            className: "mini-loader"
                                                                                        }),
                                                                                        "进行中"
                                                                                    ]
                                                                                }) : task.status === 'success' ? '已完成' : task.cancelled ? '已取消' : task.interrupted ? '已中断' : '部分失败'
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("time", {
                                                                                children: ((task.status === 'pending' ? generateClock : task.completedAt || generateClock) - task.startedAt) / 1000 < 0.1 ? '0.1s' : `${(((task.status === 'pending' ? generateClock : task.completedAt || generateClock) - task.startedAt) / 1000).toFixed(1)}s`
                                                                            }),
                                                                            task.request && /*#__PURE__*/ _jsx("button", {
                                                                                type: "button",
                                                                                className: "task-restore-button",
                                                                                onClick: ()=>restoreGenerateTask(task),
                                                                                children: "恢复参数"
                                                                            }),
                                                                            task.request && task.status === 'error' && /*#__PURE__*/ _jsxs("button", {
                                                                                type: "button",
                                                                                className: "task-retry-button",
                                                                                onClick: ()=>void retryGenerateTask(task),
                                                                                children: [
                                                                                    "重试",
                                                                                    task.items.length > 0 && task.items.length < task.expectedCount ? `剩余 ${task.expectedCount - task.items.length} 张` : '本轮'
                                                                                ]
                                                                            })
                                                                        ]
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: `result-grid ${task.status === 'pending' ? 'task-loading-results' : 'task-result-grid'}`,
                                                                children: [
                                                                    task.items.map((item)=>/*#__PURE__*/ _jsx(ImageCard, {
                                                                            item: item,
                                                                            previousItem: getGalleryParent(item),
                                                                            onPreview: ()=>openViewer(item),
                                                                            onEdit: ()=>openEdit(item),
                                                                            onUpscale: ()=>openUpscale(item),
                                                                            onReuse: ()=>reuseItem(item),
                                                                            onReference: ()=>useAsReference(item),
                                                                            onPushVideo: ()=>pushToVideo(item),
                                                                            onCompare: ()=>openCompare(item),
                                                                            onReversePrompt: ()=>reversePrompt(item),
                                                                            onFavorite: ()=>void toggleFavorite(item),
                                                                            onDownload: ()=>void downloadUrl(item.url, `SANMAO-${item.id}.png`),
                                                                            onDownloadShare: ()=>downloadShareImage(item).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                                                            onDelete: ()=>askDeleteItems([
                                                                                    item.id
                                                                                ])
                                                                        }, item.id)),
                                                                    task.status === 'pending' && Array.from({
                                                                        length: Math.max(0, task.expectedCount - task.items.length)
                                                                    }, (_, imageIndex)=>/*#__PURE__*/ _jsxs("article", {
                                                                            className: "loading-card",
                                                                            children: [
                                                                                /*#__PURE__*/ _jsxs("div", {
                                                                                    className: "loading-stage",
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("span", {
                                                                                            className: "loading-orb"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsxs("small", {
                                                                                            children: [
                                                                                                "等待第 ",
                                                                                                task.items.length + imageIndex + 1,
                                                                                                " / ",
                                                                                                task.expectedCount,
                                                                                                " 张返回"
                                                                                            ]
                                                                                        })
                                                                                    ]
                                                                                }),
                                                                                /*#__PURE__*/ _jsxs("div", {
                                                                                    className: "loading-card-body",
                                                                                    children: [
                                                                                        /*#__PURE__*/ _jsx("strong", {
                                                                                            children: "正在生成图片"
                                                                                        }),
                                                                                        /*#__PURE__*/ _jsx("small", {
                                                                                            children: "哪张先完成就先显示"
                                                                                        })
                                                                                    ]
                                                                                })
                                                                            ]
                                                                        }, `loading-${imageIndex}`))
                                                                ]
                                                            }),
                                                            task.status === 'error' && /*#__PURE__*/ _jsxs("div", {
                                                                className: "generation-task-error",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx(Icon, {
                                                                        name: "close",
                                                                        size: 18
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("strong", {
                                                                                children: task.cancelled ? '本轮任务已取消' : task.interrupted ? '本轮任务已中断' : '本轮部分生成失败'
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("small", {
                                                                                children: task.cancelled ? '任务已停止，已返回的图片仍会保留。' : task.interrupted ? '页面状态中断，可恢复参数后重新提交。' : task.items.length ? `${task.items.length} / ${task.expectedCount} 张已完成，可重试失败部分。` : '未收到可用图片，请检查模型连接或稍后重试。'
                                                                            }),
                                                                            task.error && /*#__PURE__*/ _jsxs("details", {
                                                                                className: "generation-error-details",
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("summary", {
                                                                                        children: "查看技术详情"
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("p", {
                                                                                        children: task.error
                                                                                    })
                                                                                ]
                                                                            })
                                                                        ]
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    }, task.id))
                                            }) : resultItems.length ? /*#__PURE__*/ _jsx("div", {
                                                className: `result-grid ${resultItems.length === 1 ? 'featured-results' : ''}`,
                                                children: resultItems.map((item)=>/*#__PURE__*/ _jsx(ImageCard, {
                                                        item: item,
                                                        previousItem: getGalleryParent(item),
                                                        onPreview: ()=>openViewer(item),
                                                        onEdit: ()=>openEdit(item),
                                                        onUpscale: ()=>openUpscale(item),
                                                        onReuse: ()=>reuseItem(item),
                                                        onReference: ()=>useAsReference(item),
                                                        onPushVideo: ()=>pushToVideo(item),
                                                        onCompare: ()=>openCompare(item),
                                                        onReversePrompt: ()=>reversePrompt(item),
                                                        onFavorite: ()=>void toggleFavorite(item),
                                                        onDownload: ()=>void downloadUrl(item.url, `SANMAO-${item.id}.png`),
                                                        onDownloadShare: ()=>downloadShareImage(item).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                                        onDelete: ()=>askDeleteItems([
                                                                item.id
                                                            ])
                                                    }, item.id))
                                            }) : /*#__PURE__*/ _jsxs("div", {
                                                className: "empty-result",
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "empty-icon",
                                                        children: /*#__PURE__*/ _jsx(Icon, {
                                                            name: "image",
                                                            size: 28
                                                        })
                                                    }),
                                                    /*#__PURE__*/ _jsx("h2", {
                                                        children: "生成结果会出现在这里"
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        children: "你可以连续提交多轮任务，不必等待上一轮完成。每轮结果会按不同颜色分组，并自动保存到创作记录。"
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            maskEditorOpen && generateRefs[0] && /*#__PURE__*/ _jsx(MaskEditor, {
                                imageUrl: generateRefs[0].dataUrl,
                                initialMaskDataUrl: generateMask?.referenceId === generateRefs[0].id ? generateMask.dataUrl : undefined,
                                onCancel: ()=>setMaskEditorOpen(false),
                                onApply: (dataUrl)=>{
                                    setGenerateMask({
                                        referenceId: generateRefs[0].id,
                                        dataUrl
                                    });
                                    setMaskEditorOpen(false);
                                    notify('蒙版已设置，生成时会一并提交给服务商');
                                }
                            }),
                            section === 'history' && recordTab === 'works' && /*#__PURE__*/ _jsxs("section", {
                                className: "history-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "history-toolbar surface",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "record-tab-switcher",
                                                role: "tablist",
                                                "aria-label": "创作记录视图",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", { type: "button", role: "tab", "aria-selected": recordTab === 'works', className: recordTab === 'works' ? 'active' : '', onClick: ()=>{ setRecordTab('works'); setSection('history'); void refreshGallery(); void refreshVideoTasks(); }, children: "作品" }),
                                                    /*#__PURE__*/ _jsx("button", { type: "button", role: "tab", "aria-selected": recordTab === 'tasks', className: recordTab === 'tasks' ? 'active' : '', onClick: ()=>{ setRecordTab('tasks'); setSection('logs'); markLogErrorNoticeSeen(); void refreshGenerationLogs(); void refreshVideoTasks(); }, children: "任务" })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "search-box",
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "search",
                                                        size: 17
                                                    }),
                                                    /*#__PURE__*/ _jsx("input", {
                                                        value: historySearch,
                                                        onChange: (e)=>setHistorySearch(e.target.value),
                                                        placeholder: "搜索提示词或模型…"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "media-filter-chips",
                                                children: [
                                                    ['all', '全部作品'],
                                                    ['image', '图片'],
                                                    ['video', '视频'],
                                                    ['audio', '音频 · 即将上线']
                                                ].map(([value, label])=>/*#__PURE__*/ _jsx("button", { type: "button", disabled: value === 'audio', className: historyMediaFilter === value ? 'active' : '', onClick: ()=>setHistoryMediaFilter(value), children: label }, value))
                                            }),
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "filter-chips",
                                                children: [
                                                    [
                                                        'all',
                                                        '全部'
                                                    ],
                                                    [
                                                        'favorite',
                                                        '收藏'
                                                    ],
                                                    [
                                                        'generate',
                                                        '直接生成'
                                                    ],
                                                    [
                                                        'agent',
                                                        '助手生成'
                                                    ],
                                                    [
                                                        'edit',
                                                        '图片修改'
                                                    ],
                                                    [
                                                        'canvas',
                                                        '画布生成'
                                                    ],
                                                    [
                                                        'upscale',
                                                        '高清放大'
                                                    ]
                                                ].map(([value, label])=>/*#__PURE__*/ _jsx("button", {
                                                        className: historyFilter === value ? 'active' : '',
                                                        onClick: ()=>setHistoryFilter(value),
                                                        children: label
                                                    }, value))
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "history-controls",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: selectionMode ? 'ghost-button active' : 'ghost-button',
                                                        onClick: ()=>{
                                                            setSelectionMode((v)=>!v);
                                                            setSelectedHistory(new Set());
                                                        },
                                                        children: selectionMode ? '退出多选' : '批量选择'
                                                    }),
                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                        value: String(pageSize),
                                                        options: pageSizeOptions,
                                                        onChange: (v)=>{
                                                            const n = Number(v);
                                                            setPageSize(n);
                                                            try {
                                                                localStorage.setItem('sanmao-history-page-size', v);
                                                            } catch  {}
                                                        },
                                                        className: "page-size-dropdown"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    selectionMode && /*#__PURE__*/ _jsxs("div", {
                                        className: "batch-bar",
                                        children: [
                                            /*#__PURE__*/ _jsxs("span", {
                                                children: [
                                                    "已选择 ",
                                                    selectedHistory.size,
                                                    " 张"
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        disabled: !selectedHistory.size,
                                                        onClick: ()=>{
                                                            for (const id of selectedHistory){
                                                                const item = gallery.find((x)=>x.id === id);
                                                                if (item) void downloadUrl(item.url, `SANMAO-${item.id}.png`);
                                                            }
                                                        },
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "download",
                                                                size: 15
                                                            }),
                                                            "逐张下载"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        className: "push-video-batch",
                                                        disabled: !selectedHistory.size,
                                                        onClick: ()=>pushSelectedToVideo(),
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "video",
                                                                size: 15
                                                            }),
                                                            "推送到视频"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        className: "danger",
                                                        disabled: !selectedHistory.size,
                                                        onClick: ()=>askDeleteItems([
                                                                ...selectedHistory
                                                            ]),
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "trash",
                                                                size: 15
                                                            }),
                                                            "删除所选"
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    visibleVideoTasks.length > 0 && /*#__PURE__*/ _jsxs("section", {
                                        className: "creative-record-group",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", { className: "creative-record-group-heading", children: [
                                                /*#__PURE__*/ _jsx("div", { children: [/*#__PURE__*/ _jsx("strong", { children: "视频作品" }), /*#__PURE__*/ _jsx("small", { children: "已完成的视频会自动保存在这里" })] }),
                                                /*#__PURE__*/ _jsx("span", { children: `${visibleVideoTasks.length} 段` })
                                            ] }),
                                            /*#__PURE__*/ _jsx("div", { className: "creative-video-grid", children: visibleVideoTasks.map((task)=>/*#__PURE__*/ _jsx(VideoRecordCard, { task, onNotify: notify, onDelete: ()=>askDeleteVideoTask(task) }, task.id)) })
                                        ]
                                    }),
                                    filteredGallery.length ? /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "history-grid",
                                                children: pagedGallery.map((item, index)=>/*#__PURE__*/ _jsx(ImageCard, {
                                                        item: item,
                                                        priority: index < 4,
                                                        previousItem: getGalleryParent(item),
                                                        selectionMode: selectionMode,
                                                        selected: selectedHistory.has(item.id),
                                                        onSelect: ()=>setSelectedHistory((old)=>{
                                                                const next = new Set(old);
                                                                if (next.has(item.id)) next.delete(item.id);
                                                                else next.add(item.id);
                                                                return next;
                                                            }),
                                                        onPreview: ()=>openViewer(item),
                                                        onEdit: ()=>openEdit(item),
                                                        onUpscale: ()=>openUpscale(item),
                                                        onReuse: ()=>reuseItem(item),
                                                        onReference: ()=>useAsReference(item),
                                                        onPushVideo: ()=>pushToVideo(item),
                                                        onCompare: ()=>openCompare(item),
                                                        onReversePrompt: ()=>reversePrompt(item),
                                                        onFavorite: ()=>void toggleFavorite(item),
                                                        onDownload: ()=>void downloadUrl(item.url, `SANMAO-${item.id}.png`),
                                                        onDownloadShare: ()=>downloadShareImage(item).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                                        onDelete: ()=>askDeleteItems([
                                                                item.id
                                                            ])
                                                    }, item.id))
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "pagination",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("span", {
                                                        children: [
                                                            "共 ",
                                                            filteredGallery.length,
                                                            " 张 \xb7 第 ",
                                                            Math.min(page, totalPages),
                                                            " / ",
                                                            totalPages,
                                                            " 页"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                disabled: page <= 1,
                                                                onClick: ()=>setPage((v)=>Math.max(1, v - 1)),
                                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "left",
                                                                    size: 16
                                                                })
                                                            }),
                                                            Array.from({
                                                                length: Math.min(5, totalPages)
                                                            }, (_, i)=>{
                                                                const start = Math.max(1, Math.min(page - 2, totalPages - 4));
                                                                const p = start + i;
                                                                return p <= totalPages ? /*#__PURE__*/ _jsx("button", {
                                                                    className: page === p ? 'active' : '',
                                                                    onClick: ()=>setPage(p),
                                                                    children: p
                                                                }, p) : null;
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                disabled: page >= totalPages,
                                                                onClick: ()=>setPage((v)=>Math.min(totalPages, v + 1)),
                                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "right",
                                                                    size: 16
                                                                })
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }) : hasCreativeRecords ? null : /*#__PURE__*/ _jsxs("div", {
                                        className: "history-empty",
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "empty-icon",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "history",
                                                    size: 28
                                                })
                                            }),
                                            /*#__PURE__*/ _jsx("h2", {
                                                children: gallery.length || videoTasks.length ? '没有符合条件的作品' : '还没有创作记录'
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                    children: gallery.length ? '换个关键词或筛选条件试试。' : '每次生图、助手生成、画布生成、图片修改和高清放大都会自动保存在这个浏览器里。'
                                            }),
                                            !gallery.length && /*#__PURE__*/ _jsxs("div", {
                                                className: "history-empty-actions",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "primary-action compact",
                                                        onClick: ()=>setSection('agent'),
                                                        children: "让助手帮我生成"
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "secondary-action",
                                                        onClick: ()=>setSection('generate'),
                                                        children: "直接开始生图"
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            videoReferenceQueue.length > 0 && (section === 'generate' || (section === 'history' && recordTab === 'works')) && /*#__PURE__*/ _jsxs("div", {
                                className: "video-reference-dock",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "video-reference-dock-thumbs",
                                        children: [
                                            videoReferenceQueue.slice(0, 4).map((queued, index)=>/*#__PURE__*/ _jsx("img", {
                                                src: queued.url,
                                                alt: "参考图 " + (index + 1)
                                            }, queued.id)),
                                            videoReferenceQueue.length > 4 && /*#__PURE__*/ _jsx("span", {
                                                className: "video-reference-dock-label",
                                                children: "+" + (videoReferenceQueue.length - 4)
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "video-reference-dock-meta",
                                        children: [
                                            /*#__PURE__*/ _jsx("strong", {
                                                children: videoReferenceQueue.length + " 张"
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "视频参考"
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        className: "video-reference-dock-go",
                                        onClick: ()=>{
                                            void goVideoFromQueue();
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "video",
                                                size: 14
                                            }),
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "去视频生成"
                                            }),
                                            /*#__PURE__*/ _jsxs("b", {
                                                children: [
                                                    videoReferenceQueue.length,
                                                    " 张"
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        className: "video-reference-dock-clear",
                                        onClick: clearVideoQueue,
                                        title: "清空已添加的视频参考图",
                                        "aria-label": "清空已添加的视频参考图",
                                        children: /*#__PURE__*/ _jsx("span", {
                                            "aria-hidden": "true",
                                            children: "×"
                                        })
                                    })
                                ]
                            }),
                            section === 'logs' && recordTab === 'tasks' && /*#__PURE__*/ _jsxs("section", {
                                className: "history-page logs-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "history-toolbar surface logs-toolbar",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "record-tab-switcher",
                                                role: "tablist",
                                                "aria-label": "创作记录视图",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", { type: "button", role: "tab", "aria-selected": recordTab === 'works', className: recordTab === 'works' ? 'active' : '', onClick: ()=>{ setRecordTab('works'); setSection('history'); void refreshGallery(); void refreshVideoTasks(); }, children: "作品" }),
                                                    /*#__PURE__*/ _jsx("button", { type: "button", role: "tab", "aria-selected": recordTab === 'tasks', className: recordTab === 'tasks' ? 'active' : '', onClick: ()=>{ setRecordTab('tasks'); setSection('logs'); void refreshGenerationLogs(); void refreshVideoTasks(); }, children: "任务" })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-toolbar-copy",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        className: "log-eyebrow",
                                                        children: "RUN MONITOR"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: "生成任务"
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: "服务端同步展示进行中、成功和失败任务"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-toolbar-controls",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("label", {
                                                        className: "log-search-box",
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "search",
                                                                size: 14
                                                            }),
                                                            /*#__PURE__*/ _jsx("input", {
                                                                value: logSearch,
                                                                onChange: (e)=>setLogSearch(e.target.value),
                                                                placeholder: "搜索提示词、模型或服务商",
                                                                "aria-label": "搜索生成任务"
                                                            }),
                                                            logSearch && /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "log-search-clear",
                                                                onClick: ()=>setLogSearch(''),
                                                                "aria-label": "清除搜索",
                                                                children: "×"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "media-filter-chips compact",
                                                        children: [
                                                            ['all', '全部'],
                                                            ['image', '图片'],
                                                            ['video', '视频'],
                                                            ['audio', '音频 · 即将上线']
                                                        ].map(([value, label])=>/*#__PURE__*/ _jsx("button", { type: "button", disabled: value === 'audio', className: historyMediaFilter === value ? 'active' : '', onClick: ()=>setHistoryMediaFilter(value), children: label }, value))
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "filter-chips log-filters",
                                                        children: [
                                                            [
                                                                'all',
                                                                '全部'
                                                            ],
                                                            [
                                                                'pending',
                                                                '进行中'
                                                            ],
                                                            [
                                                                'success',
                                                                '成功'
                                                            ],
                                                            [
                                                                'error',
                                                                '失败'
                                                            ]
                                                        ].map(([value, label])=>/*#__PURE__*/ _jsxs("button", {
                                                                className: logFilter === value ? 'active' : '',
                                                                onClick: ()=>setLogFilter(value),
                                                                children: [
                                                                    label,
                                                                    /*#__PURE__*/ _jsx("b", {
                                                                        children: value === 'all' ? generationLogs.length : generationLogs.filter((log)=>log.status === value).length
                                                                    })
                                                                ]
                                                            }, value))
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "ghost-button log-refresh-button",
                                                        onClick: ()=>void refreshGenerationLogs(),
                                                        children: "刷新"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "log-summary-grid",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-summary-card total",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "全部任务"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: logSummary.total
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: "服务端日志"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-summary-card pending",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "进行中"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: logSummary.pending
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: logSummary.pending ? "后台持续生成" : "当前队列为空"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-summary-card success",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "成功率"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("strong", {
                                                        children: [
                                                            logSummary.successRate,
                                                            "%"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("small", {
                                                        children: [
                                                            logSummary.success,
                                                            " 次成功"
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-summary-card duration",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "平均耗时"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: logSummary.averageDuration
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: "已完成任务"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-summary-card error",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "失败"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: logSummary.error
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: logSummary.error ? "建议检查详情" : "状态很稳定"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "storage-settings surface",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: "图片存储路径"
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: "默认保存到 .data/images；旧版本项目同级的 image_generation_records 会保留读取兼容。修改并保存后，后续图片都会使用新路径。"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "storage-row",
                                                children: [
                                                    /*#__PURE__*/ _jsx("input", {
                                                        value: storagePath,
                                                        onChange: (e)=>setStoragePath(e.target.value),
                                                        placeholder: "默认路径：.data/images"
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "ghost-button",
                                                        disabled: storageBusy,
                                                        onClick: ()=>void saveStoragePath(''),
                                                        children: "使用默认路径"
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "primary-small",
                                                        disabled: storageBusy,
                                                        onClick: ()=>void saveStoragePath(),
                                                        children: storageBusy ? '保存中…' : '保存路径'
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "primary-small open-storage-button",
                                                        disabled: storageBusy,
                                                        onClick: async ()=>{
                                                            const res = await fetch('/api/storage/open', {
                                                                method: 'POST'
                                                            });
                                                            const data = await res.json();
                                                            if (!res.ok) notify(data.error || '打开目录失败');
                                                        },
                                                        children: "↗ 一键打开保存目录"
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "ghost-button local-folder-button",
                                                        onClick: ()=>void chooseLocalDirectory(),
                                                        children: "选择本地目录"
                                                    }),
                                                    localDirectoryName && /*#__PURE__*/ _jsxs("span", {
                                                        className: "local-folder-name",
                                                        children: [
                                                            "已选择：",
                                                            localDirectoryName
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "log-cleanup-row",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("strong", {
                                                                children: "日志清理"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "建议保留最近 90 天；只清理日志不会删除图片。"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "log-cleanup-actions",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(90, false),
                                                                children: "清理 90 天前日志"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(90, true),
                                                                children: "清理日志及图片"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button danger-text-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(undefined, false),
                                                                children: "清空全部日志"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    !filteredGenerationLogs.length ? /*#__PURE__*/ _jsxs("div", {
                                        className: "history-empty",
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "empty-icon",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "history",
                                                    size: 28
                                                })
                                            }),
                                            /*#__PURE__*/ _jsx("h2", {
                                                children: generationLogs.length ? '没有符合条件的任务' : '还没有生成任务'
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                children: generationLogs.length ? '切换媒体类型或状态筛选后查看其他任务。' : '任务提交后会立即显示在这里。'
                                            })
                                        ]
                                    }) : /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "log-list",
                                                children: pagedGenerationLogs.map((log)=>/*#__PURE__*/ _jsxs("article", {
                                                        className: `log-row surface ${log.status}`,
                                                        children: [
                                                            generationMediaKind(log) === 'video' && log.videoUrls?.length ? /*#__PURE__*/ _jsx("div", {
                                                                className: "log-preview log-video-preview",
                                                                children: /*#__PURE__*/ _jsx("video", { src: log.videoUrls[0], controls: true, playsInline: true, preload: "metadata" })
                                                            }) : log.imageUrls?.length ? /*#__PURE__*/ _jsx("div", {
                                                                className: "log-preview",
                                                                children: log.imageUrls.slice(0, 3).map((url, index)=>/*#__PURE__*/ _jsx("a", {
                                                                        href: url,
                                                                        target: "_blank",
                                                                        rel: "noreferrer",
                                                                        onClick: ()=>markHistoryNoticeSeen(),
                                                                        children: /*#__PURE__*/ _jsx("img", {
                                                                            src: url,
                                                                            alt: `生成结果 ${index + 1}`
                                                                        })
                                                                    }, `${url}-${index}`))
                                                                }) : /*#__PURE__*/ _jsx("div", {
                                                                className: "log-preview-placeholder",
                                                                children: log.status === 'pending' ? /*#__PURE__*/ _jsx("span", {
                                                                    className: "loading-orb log-loading-orb"
                                                                }) : /*#__PURE__*/ _jsx(Icon, {
                                                                    name: generationMediaKind(log) === 'video' ? 'video' : generationMediaKind(log) === 'audio' ? 'audio' : 'image',
                                                                    size: 18
                                                                })
                                                            }),
                                                            /*#__PURE__*/ _jsx("div", {
                                                                className: "log-status",
                                                                children: log.status === 'pending' ? '进行中' : log.status === 'success' ? '成功' : '失败'
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "log-main",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                        children: log.prompt || '未填写提示词'
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("small", {
                                                                        children: [
                                                                            generationLogSourceLabel(log),
                                                                            " \xb7 ",
                                                                            log.modelName || '自动选择模型',
                                                                            " \xb7 ",
                                                                            log.providerName || '等待服务商响应'
                                                                        ]
                                                                    }),
                                                                    log.status === 'pending' && /*#__PURE__*/ _jsx("small", {
                                                                        className: "log-pending-note",
                                                                        children: "任务正在后台生成，可继续提交其他任务"
                                                                    }),
                                                                    log.error && /*#__PURE__*/ _jsx("small", {
                                                                        className: "log-error",
                                                                        children: log.error
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "log-meta",
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("span", {
                                                                        className: "log-meta-chip log-count-chip",
                                                                        children: [
                                                                            generationMediaKind(log) === 'video' ? (log.videoUrls?.length || (log.status === 'pending' ? 1 : 0)) : generationMediaKind(log) === 'audio' ? 1 : log.status === 'pending' ? log.count ?? 1 : log.imageCount ?? 0,
                                                                            generationMediaKind(log) === 'video' ? ' 段视频' : generationMediaKind(log) === 'audio' ? ' 段音频' : log.references?.length ? ` 张 · 参考图 ${log.references.length}` : " 张"
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("span", {
                                                                        className: `log-meta-chip log-duration-chip ${log.status === 'pending' ? 'pending' : logDurationTone(log.durationMs)}`,
                                                                        children: [
                                                                            "⏱ ",
                                                                            log.status === 'pending' ? `${Math.max(.1, (generateClock - new Date(log.createdAt).getTime()) / 1000).toFixed(1)}s` : log.durationMs ? `${(log.durationMs / 1000).toFixed(1)}s` : '—'
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("span", {
                                                                        className: "log-meta-chip log-size-chip",
                                                                        children: [
                                                                            generationMediaKind(log) === 'video' ? `${log.operation === 'edit' ? '编辑' : log.operation === 'extend' ? '扩展' : '生成'} · ${log.resolution || '自动分辨率'}` : generationMediaKind(log) === 'audio' ? '音频 · 参数详情' : logResolutionLabel(log, logImageSpecs[log.id]),
                                                                            generationMediaKind(log) === 'image' && " · ",
                                                                            generationMediaKind(log) === 'image' && logOutputSizeLabel(log, logImageSpecs[log.id]),
                                                                            generationMediaKind(log) === 'image' && " · ",
                                                                            generationMediaKind(log) === 'image' && logAspectRatioLabel(log, logImageSpecs[log.id])
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("time", {
                                                                        children: new Date(log.createdAt).toLocaleString('zh-CN', {
                                                                            hour12: false
                                                                        })
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("button", {
                                                                        className: "log-detail-button",
                                                                        onClick: ()=>setSelectedLog(log),
                                                                        children: "查看详情"
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    }, log.id))
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "pagination",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("span", {
                                                        children: [
                                                            "共 ",
                                                            filteredGenerationLogs.length,
                                                            " 条 \xb7 第 ",
                                                            Math.min(logPage, logTotalPages),
                                                            " / ",
                                                            logTotalPages,
                                                            " 页"
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                disabled: logPage <= 1,
                                                                onClick: ()=>setLogPage((value)=>Math.max(1, value - 1)),
                                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "left",
                                                                    size: 16
                                                                })
                                                            }),
                                                            Array.from({
                                                                length: Math.min(5, logTotalPages)
                                                            }, (_, index)=>{
                                                                const start = Math.max(1, Math.min(logPage - 2, logTotalPages - 4));
                                                                const pageNumber = start + index;
                                                                return pageNumber <= logTotalPages ? /*#__PURE__*/ _jsx("button", {
                                                                    className: logPage === pageNumber ? 'active' : '',
                                                                    onClick: ()=>setLogPage(pageNumber),
                                                                    children: pageNumber
                                                                }, pageNumber) : null;
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                disabled: logPage >= logTotalPages,
                                                                onClick: ()=>setLogPage((value)=>Math.min(logTotalPages, value + 1)),
                                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                                    name: "right",
                                                                    size: 16
                                                                })
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            section === 'settings' && /*#__PURE__*/ _jsxs("section", {
                                className: "settings-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "settings-intro",
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "settings-intro-icon",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "settings",
                                                    size: 22
                                                })
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("h1", {
                                                        children: "设置"
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        children: "把界面偏好、通知、图片存储和日志管理集中放在这里。后续新增功能也会优先归档到设置页。"
                                                    })
                                                ]
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("nav", {
                                className: "settings-section-nav",
                                "aria-label": "设置分组",
                                children: [
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>document.getElementById('settings-appearance')?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            }),
                                        children: "偏好"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>document.getElementById('settings-search')?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            }),
                                        children: "联网"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>document.getElementById('settings-storage')?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            }),
                                        children: "存储"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>document.getElementById('settings-backup')?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            }),
                                        children: "备份"
                                    }),
                                    /*#__PURE__*/ _jsx("button", {
                                        type: "button",
                                        onClick: ()=>document.getElementById('settings-maintenance')?.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            }),
                                        children: "维护"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "settings-layout",
                                children: [
                                    /*#__PURE__*/ _jsxs("section", {
                                        id: "settings-appearance",
                                        className: "settings-card surface",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "界面外观"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "主题模式"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: theme === 'light' ? 'sun' : 'moon',
                                                                size: 18
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                        children: "选择适合当前工作环境的界面颜色。"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-theme-options",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("button", {
                                                                type: "button",
                                                                className: theme === 'light' ? 'active' : '',
                                                                onClick: ()=>setThemePreference('light'),
                                                                children: [
                                                                    /*#__PURE__*/ _jsx(Icon, {
                                                                        name: "sun",
                                                                        size: 17
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "浅色"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("small", {
                                                                        children: "明亮清晰"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("button", {
                                                                type: "button",
                                                                className: theme === 'dark' ? 'active' : '',
                                                                onClick: ()=>setThemePreference('dark'),
                                                                children: [
                                                                    /*#__PURE__*/ _jsx(Icon, {
                                                                        name: "moon",
                                                                        size: 17
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "深色"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("small", {
                                                                        children: "适合夜间"
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("section", {
                                                className: "settings-card surface",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "通知"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "出图成功音效"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("label", {
                                                                className: `settings-switch ${successSoundEnabled ? 'on' : ''}`,
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("input", {
                                                                        type: "checkbox",
                                                                        checked: successSoundEnabled,
                                                                        onChange: (e)=>setSuccessSoundPreference(e.target.checked)
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("span", {})
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                        children: "图片生成、超分或智能助手成功生成图片后播放一声短提示音。默认关闭，不会影响失败提示。"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-option-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: successSoundEnabled ? 'settings-state on' : 'settings-state',
                                                                children: successSoundEnabled ? '已开启' : '已关闭'
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "ghost-button",
                                                                onClick: ()=>successSoundEnabled ? playSuccessSound() : notify('请先打开出图成功音效'),
                                                                children: "试听音效"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("section", {
                                                id: "settings-search",
                                                className: "settings-card surface settings-search-api",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "联网搜索"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "搜索API"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "globe",
                                                                size: 18
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                         children: "联网搜索支持模型原生搜索、AnySearch 和百度千帆。当前模型带“原生联网”能力时会优先调用模型自身搜索；原生搜索失败、限流或无结果时自动回退外部搜索 API。没有原生搜索能力的模型直接使用 AnySearch/百度千帆。AnySearch 默认可使用匿名免费额度，配置 ANYSEARCH_API_KEY 后可获得更高额度；百度千帆 Key 会加密保存在本机服务端，也可使用 QIANFAN_API_KEY。"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-api-grid",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("label", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "服务商"
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        className: `settings-provider-select ${webSearchProviderMenuOpen ? 'open' : ''}`,
                                                                        ref: webSearchProviderMenuRef,
                                                                        children: [
                                                                            /*#__PURE__*/ _jsxs("button", {
                                                                                type: "button",
                                                                                className: "settings-provider-trigger",
                                                                                "aria-haspopup": "listbox",
                                                                                "aria-expanded": webSearchProviderMenuOpen,
                                                                                onClick: ()=>setWebSearchProviderMenuOpen((value)=>!value),
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("span", {
                                                                                        className: "settings-provider-logo",
                                                                                        children: webSearchAnySearchSelected ? "A" : "百"
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsxs("span", {
                                                                                        className: "settings-provider-copy",
                                                                                        children: [
                                                                                            /*#__PURE__*/ _jsx("strong", {
                                                                                                children: webSearchAnySearchSelected ? "AnySearch" : "百度千帆"
                                                                                            }),
                                                                                            /*#__PURE__*/ _jsx("small", {
                                                                                                children: webSearchAnySearchSelected ? webSearchAnySearchKeyConfigured ? "环境变量 Key" : "匿名免费额度" : "Key 可加密保存"
                                                                                            })
                                                                                        ]
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("span", {
                                                                                        className: "settings-provider-chevron",
                                                                                        children: "⌄"
                                                                                    })
                                                                                ]
                                                                            }),
                                                                            webSearchProviderMenuOpen && /*#__PURE__*/ _jsxs("div", {
                                                                                className: "settings-provider-menu",
                                                                                role: "listbox",
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsxs("button", {
                                                                                        type: "button",
                                                                                        role: "option",
                                                                                        "aria-selected": webSearchAnySearchSelected,
                                                                                        className: `settings-provider-option ${webSearchAnySearchSelected ? 'selected' : ''}`,
                                                                                        onClick: ()=>{
                                                                                            setWebSearchApiProvider('anysearch');
                                                                                            setWebSearchApiKey('');
                                                                                            setWebSearchApiResult('');
                                                                                            setWebSearchProviderMenuOpen(false);
                                                                                        },
                                                                                        children: [
                                                                                            /*#__PURE__*/ _jsx("span", {
                                                                                                className: "settings-provider-logo anysearch",
                                                                                                children: "A"
                                                                                            }),
                                                                                            /*#__PURE__*/ _jsxs("span", {
                                                                                                className: "settings-provider-option-copy",
                                                                                                children: [
                                                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                                                        children: "AnySearch"
                                                                                                    }),
                                                                                                    /*#__PURE__*/ _jsx("small", {
                                                                                                        children: "主源 · Key 可选"
                                                                                                    })
                                                                                                ]
                                                                                            }),
                                                                                            webSearchAnySearchSelected && /*#__PURE__*/ _jsx("span", {
                                                                                                className: "settings-provider-check",
                                                                                                children: "✓"
                                                                                            })
                                                                                        ]
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsxs("button", {
                                                                                        type: "button",
                                                                                        role: "option",
                                                                                        "aria-selected": !webSearchAnySearchSelected,
                                                                                        className: `settings-provider-option ${!webSearchAnySearchSelected ? 'selected' : ''}`,
                                                                                        onClick: ()=>{
                                                                                            setWebSearchApiProvider('baidu-qianfan');
                                                                                            setWebSearchApiKey('');
                                                                                            setWebSearchApiResult('');
                                                                                            setWebSearchProviderMenuOpen(false);
                                                                                        },
                                                                                        children: [
                                                                                            /*#__PURE__*/ _jsx("span", {
                                                                                                className: "settings-provider-logo qianfan",
                                                                                                children: "百"
                                                                                            }),
                                                                                            /*#__PURE__*/ _jsxs("span", {
                                                                                                className: "settings-provider-option-copy",
                                                                                                children: [
                                                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                                                        children: "百度千帆"
                                                                                                    }),
                                                                                                    /*#__PURE__*/ _jsx("small", {
                                                                                                        children: "备用源 · 可页面保存 Key"
                                                                                                    })
                                                                                                ]
                                                                                            }),
                                                                                            !webSearchAnySearchSelected && /*#__PURE__*/ _jsx("span", {
                                                                                                className: "settings-provider-check",
                                                                                                children: "✓"
                                                                                            })
                                                                                        ]
                                                                                    })
                                                                                ]
                                                                            })
                                                                        ]
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("label", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "API Key"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("input", {
                                                                        type: "password",
                                                                        autoComplete: "off",
                                                                        disabled: webSearchAnySearchSelected,
                                                                        value: webSearchAnySearchSelected ? '' : webSearchApiKey,
                                                                        onChange: (e)=>{
                                                                            setWebSearchApiKey(e.target.value);
                                                                            setWebSearchApiResult('');
                                                                        },
                                                                        placeholder: webSearchAnySearchSelected
                                                                            ? webSearchAnySearchKeyConfigured ? '已配置 ANYSEARCH_API_KEY · 页面不显示 Key' : '未配置 Key，将使用匿名免费额度（可选配置 ANYSEARCH_API_KEY）'
                                                                            : selectedWebSearchConfigured ? `已配置 ${state.settings.webSearchKeyMasked || '••••••••'}，留空保持不变` : '粘贴百度千帆 API Key（或配置 QIANFAN_API_KEY）'
                                                                    })
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-api-actions",
                                                        children: [
                                                            !webSearchAnySearchSelected && /*#__PURE__*/ _jsx("a", {
                                                                className: "primary-small settings-api-apply",
                                                                href: "https://console.bce.baidu.com/qianfan/ais/console/apiKey",
                                                                target: "_blank",
                                                                rel: "noreferrer",
                                                                children: "↗ 申请百度千帆 Key"
                                                            }),
                                                            webSearchAnySearchSelected && /*#__PURE__*/ _jsx("span", {
                                                                className: "settings-api-env-hint",
                                                                children: webSearchAnySearchKeyConfigured ? "AnySearch Key 已从环境变量读取" : "AnySearch 使用匿名免费额度，可选配置 Key"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "secondary-action compact",
                                                                disabled: webSearchApiBusy || !webSearchApiKey.trim() && !selectedWebSearchConfigured,
                                                                onClick: ()=>void testWebSearchApiConnection(),
                                                                children: webSearchApiBusy ? '测试中…' : webSearchAnySearchSelected ? '测试 AnySearch' : '测试百度千帆'
                                                            }),
                                                            !webSearchAnySearchSelected && /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "primary-small",
                                                                disabled: webSearchApiBusy || !webSearchApiKey.trim(),
                                                                onClick: ()=>void saveWebSearchApi(),
                                                                children: webSearchApiBusy ? '保存中…' : '保存百度千帆'
                                                            }),
                                                            !webSearchAnySearchSelected && state.settings.webSearchQianfanConfigured && /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "ghost-button",
                                                                disabled: webSearchApiBusy,
                                                                onClick: ()=>void saveWebSearchApi(true),
                                                                children: "清除 API"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: `settings-api-status ${webSearchApiResult.includes('可用') || webSearchApiResult.includes('已保存') ? 'ok' : ''}`,
                                                        children: webSearchApiResult || (webSearchAnySearchSelected
                                                            ? webSearchAnySearchKeyConfigured ? 'AnySearch 已配置，将作为主源；失败、限流或无结果时自动切换百度千帆' : 'AnySearch 将使用匿名免费额度作为主源；失败、限流或无结果时自动切换百度千帆'
                                                            : selectedWebSearchConfigured ? '百度千帆已配置，将作为备用源；AnySearch 环境变量存在时会优先使用 AnySearch' : '当前未配置百度千帆，请粘贴 Key 保存，或设置 QIANFAN_API_KEY')
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("section", {
                                                id: "settings-storage",
                                                className: "settings-card surface",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "图片与文件"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "图片存储路径"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "folder",
                                                                size: 18
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                        children: "默认保存到 .data/images；旧版本项目同级的 image_generation_records 会保留读取兼容。修改并保存后，后续图片都会使用新路径。"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "storage-row settings-storage-row",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("input", {
                                                                value: storagePath,
                                                                onChange: (e)=>setStoragePath(e.target.value),
                                                                placeholder: "默认路径：.data/images"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                disabled: storageBusy,
                                                                onClick: ()=>void saveStoragePath(''),
                                                                children: "使用默认路径"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "primary-small",
                                                                disabled: storageBusy,
                                                                onClick: ()=>void saveStoragePath(),
                                                                children: storageBusy ? '保存中…' : '保存路径'
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "primary-small open-storage-button",
                                                                disabled: storageBusy,
                                                                onClick: async ()=>{
                                                                    const res = await fetch('/api/storage/open', {
                                                                        method: 'POST'
                                                                    });
                                                                    const data = await res.json();
                                                                    if (!res.ok) notify(data.error || '打开目录失败');
                                                                },
                                                                children: "↗ 一键打开保存目录"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button local-folder-button",
                                                                onClick: ()=>void chooseLocalDirectory(),
                                                                children: "选择本地目录"
                                                            }),
                                                            localDirectoryName && /*#__PURE__*/ _jsxs("span", {
                                                                className: "local-folder-name",
                                                                children: [
                                                                    "已选择：",
                                                                    localDirectoryName
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("section", {
                                                id: "settings-backup",
                                                className: "settings-card surface settings-backup",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "本地数据"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "备份与恢复"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "folder",
                                                                size: 18
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                         children: "完整备份包含接口配置、加密密钥、日志、图库索引、助手对话、界面参数和服务端图片文件，并使用独立密码加密。密码不会保存，请务必妥善保管。"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-backup-summary",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("span", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("b", {
                                                                        children: gallery.length
                                                                    }),
                                                                    " 张历史索引"
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("span", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("b", {
                                                                        children: chatSessions.length
                                                                    }),
                                                                    " 段对话"
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("span", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("b", {
                                                                        children: generationLogs.length
                                                                    }),
                                                                    " 条近期日志"
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                     /*#__PURE__*/ _jsxs("div", {
                                                         className: "settings-backup-summary",
                                                         children: [
                                                             /*#__PURE__*/ _jsxs("span", {
                                                                 children: [
                                                                     "图片 ",
                                                                     /*#__PURE__*/ _jsx("b", {
                                                                         children: formatStorageBytes(storageUsage?.images?.bytes)
                                                                     })
                                                                 ]
                                                             }),
                                                             /*#__PURE__*/ _jsxs("span", {
                                                                 children: [
                                                                     "日志 ",
                                                                     /*#__PURE__*/ _jsx("b", {
                                                                         children: formatStorageBytes(storageUsage?.logs?.bytes)
                                                                     })
                                                                 ]
                                                             }),
                                                             /*#__PURE__*/ _jsxs("span", {
                                                                 children: [
                                                                     "自动快照 ",
                                                                     /*#__PURE__*/ _jsx("b", {
                                                                         children: localSnapshots.length
                                                                     }),
                                                                     " 份"
                                                                 ]
                                                             }),
                                                             /*#__PURE__*/ _jsx("span", {
                                                                 children: localSnapshots[0] ? `最近快照 ${new Date(localSnapshots[0].createdAt).toLocaleString()} · ${formatStorageBytes(localSnapshots[0].bytes)}` : '尚无自动快照'
                                                             })
                                                         ]
                                                     }),
                                                     /*#__PURE__*/ _jsxs("div", {
                                                         className: "settings-backup-actions",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "primary-small",
                                                                disabled: backupBusy,
                                                                onClick: ()=>void exportLocalBackup(),
                                                                children: backupBusy ? '处理中…' : '导出本地备份'
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                type: "button",
                                                                className: "ghost-button",
                                                                disabled: backupBusy,
                                                                onClick: ()=>backupInputRef.current?.click(),
                                                             children: "从备份恢复"
                                                             }),
                                                             /*#__PURE__*/ _jsx("button", {
                                                                 type: "button",
                                                                 className: "ghost-button",
                                                                 disabled: backupBusy,
                                                                 onClick: ()=>void createManualSnapshot(),
                                                                 children: "立即创建快照"
                                                             }),
                                                             /*#__PURE__*/ _jsx("button", {
                                                                 type: "button",
                                                                 className: "ghost-button",
                                                                 disabled: backupBusy || !localSnapshots.length,
                                                                 onClick: ()=>{
                                                                     const latest = localSnapshots[0];
                                                                     if (!latest) return;
                                                                     setConfirmState({
                                                                         title: '恢复最近自动快照？',
                                                                         text: '当前服务端配置和日志会被快照覆盖；现有图片文件不会自动删除。恢复前会再创建一个保护快照。',
                                                                         danger: true,
                                                                         confirmText: '确认恢复',
                                                                         action: ()=>restoreLocalSnapshotByName(latest.name)
                                                                     });
                                                                 },
                                                                 children: "恢复最近快照"
                                                             }),
                                                             /*#__PURE__*/ _jsx("input", {
                                                                hidden: true,
                                                                ref: backupInputRef,
                                                                type: "file",
                                                                 accept: ".json,.sanmao.json,.tar.gz,.sanmao-backup.tar.gz,.sanmao-backup,application/json,application/gzip,application/octet-stream",
                                                                onChange: (event)=>{
                                                                    const file = event.target.files?.[0];
                                                                    if (file) void prepareRestoreBackup(file);
                                                                }
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        className: "settings-backup-warning",
                                                         children: "备份文件包含 API Key 恢复所需信息和图片文件；即使已加密，也请勿上传 GitHub 或发送给他人。"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("section", {
                                                id: "settings-maintenance",
                                                className: "settings-card surface settings-danger",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "settings-card-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", {
                                                                        children: "本地数据"
                                                                    }),
                                                                    /*#__PURE__*/ _jsx("h2", {
                                                                        children: "日志管理"
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "trash",
                                                                size: 18
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        className: "settings-card-note",
                                                         children: "建议定期清理长期不用的服务端日志；只清理日志不会删除图片，选择删除图片时会先移入本地回收站并保留 7 天。"
                                                    }),
                                                     /*#__PURE__*/ _jsxs("div", {
                                                         className: "settings-cleanup-actions",
                                                         children: [
                                                             /*#__PURE__*/ _jsx("button", {
                                                                 className: "ghost-button",
                                                                 disabled: cleanupBusy,
                                                                 onClick: ()=>void previewCleanupGenerationLogs(90, true),
                                                                 children: "预览清理占用"
                                                             }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(90, false),
                                                                children: "清理 90 天前日志"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(90, true),
                                                                children: "清理日志及图片"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "ghost-button danger-text-button",
                                                                disabled: cleanupBusy,
                                                                onClick: ()=>askCleanupGenerationLogs(undefined, false),
                                                                children: "清空全部日志"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "primary-small",
                                                                onClick: ()=>{
                                                                    setRecordTab('tasks');
                                                                    setSection('logs');
                                                                    void refreshGenerationLogs();
                                                                },
                                                                children: "查看生成任务"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }),
                            section === 'providers' && (adminRequired && !isAdmin ? /*#__PURE__*/ _jsx(AdminLogin, {
                                password: adminPassword,
                                setPassword: setAdminPassword,
                                busy: adminBusy,
                                onSubmit: loginAdmin
                            }) : /*#__PURE__*/ _jsxs("section", {
                                className: "management-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "management-head",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("h1", {
                                                        children: "接口服务商"
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        children: "选择你使用的平台，填写密钥后直接测试连接。协议、接口路径和鉴权方式都由 SANMAO.AI 自动适配，不需要手动调整。"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "management-actions",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        className: "primary-small",
                                                        onClick: openAddProvider,
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "plus",
                                                                size: 15
                                                            }),
                                                            "添加接口服务"
                                                        ]
                                                    }),
                                                    adminRequired && /*#__PURE__*/ _jsx("button", {
                                                        className: "ghost-button",
                                                        onClick: ()=>void logoutAdmin(),
                                                        children: "退出管理"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx(JimengProviderCard, {
                                        providers: state.providers,
                                        onStateChanged: setState,
                                        onNotify: notify
                                    }),
                                    /*#__PURE__*/ _jsx(UpscaleConnectionGuide, {
                                        connections: state.upscaleConnections || [],
                                        onStateChanged: setState,
                                        onNotify: notify
                                    }),
                                    (providerEditor || !state.providers.length) && /*#__PURE__*/ _jsxs("form", {
                                        className: "provider-form surface provider-simple-form",
                                        onSubmit: saveProvider,
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "form-heading",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                className: providerEditId ? 'editing-form-label' : '',
                                                                children: providerEditId ? `正在编辑 · ${providerForm.name}` : state.providers.length ? '新增连接' : '快速接入'
                                                            }),
                                                            /*#__PURE__*/ _jsx("h2", {
                                                                children: providerEditId ? `${providerForm.name} 的服务配置` : '选择平台并连接'
                                                            }),
                                                            /*#__PURE__*/ _jsx("p", {
                                                                children: "你只需要选择服务商、粘贴必要信息并点击连接，系统会自动测试接口和读取模型。"
                                                            })
                                                        ]
                                                    }),
                                                    state.providers.length > 0 && /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "icon-button",
                                                        onClick: ()=>{
                                                            setProviderEditor(false);
                                                            setProviderEditId(null);
                                                        },
                                                        children: /*#__PURE__*/ _jsx(Icon, {
                                                            name: "close",
                                                            size: 16
                                                        })
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "platform-picker",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "platform-picker-head",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "1. 选择服务商"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "New API、One API 和自建中转，请选“其他兼容平台”"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsx("div", {
                                                        children: providerPresets.filter((preset)=>preset.showInPicker !== false).map((preset)=>/*#__PURE__*/ _jsxs("div", {
                                                                className: "platform-option",
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("button", {
                                                                        type: "button",
                                                                        className: providerForm.platform === preset.value ? 'active' : '',
                                                                        onClick: ()=>applyProviderPreset(preset.value),
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("b", {
                                                                                children: preset.short.slice(0, 2)
                                                                            }),
                                                                            /*#__PURE__*/ _jsxs("span", {
                                                                                children: [
                                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                                        children: preset.label
                                                                                    }),
                                                                                    /*#__PURE__*/ _jsx("small", {
                                                                                        children: preset.description
                                                                                    })
                                                                                ]
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("em", {
                                                                                children: preset.recommended ? '推荐' : preset.needsBaseUrl ? '填地址' : '地址已内置'
                                                                            }),
                                                                            providerForm.platform === preset.value && /*#__PURE__*/ _jsx(Icon, {
                                                                                name: "check",
                                                                                size: 14
                                                                            })
                                                                        ]
                                                                    }),
                                                                    preset.apiKeyUrl && /*#__PURE__*/ _jsx("a", {
                                                                        className: "platform-key-link",
                                                                        href: preset.apiKeyUrl,
                                                                        target: "_blank",
                                                                        rel: "noreferrer",
                                                                        onClick: (event)=>event.stopPropagation(),
                                                                        children: "↗ 获取 API Key"
                                                                    }),
                                                                    preset.notice && /*#__PURE__*/ _jsx("span", {
                                                                        className: `platform-notice ${preset.noticeTone === 'success' ? 'success' : ''}`,
                                                                        children: preset.notice
                                                                    })
                                                                ]
                                                            }, preset.value))
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "provider-auto-note",
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "check",
                                                        size: 18
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("strong", {
                                                                children: selectedProviderPreset.label
                                                            }),
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: selectedProviderPreset.description
                                                            }),
                                                            selectedProviderPreset.notice && /*#__PURE__*/ _jsx("small", {
                                                                className: `provider-preset-notice ${selectedProviderPreset.noticeTone === 'success' ? 'success' : ''}`,
                                                                children: selectedProviderPreset.notice
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "provider-auto-note-actions",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("em", {
                                                                children: "兼容参数已自动配置"
                                                            }),
                                                            selectedProviderPreset.apiKeyUrl && /*#__PURE__*/ _jsx("a", {
                                                                className: "provider-key-link",
                                                                href: selectedProviderPreset.apiKeyUrl,
                                                                target: "_blank",
                                                                rel: "noreferrer",
                                                                children: "↗ 一键获取 API Key"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "provider-fields provider-simple-fields",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("label", {
                                                        className: "wide provider-name-field",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "连接名称（可选）"
                                                            }),
                                                            /*#__PURE__*/ _jsx("input", {
                                                                value: providerForm.name,
                                                                onChange: (e)=>setProviderForm({
                                                                        ...providerForm,
                                                                        name: e.target.value
                                                                    }),
                                                                placeholder: "例如：主接口 / 备用接口"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "只用于列表识别，修改名称不会影响接口配置。"
                                                            })
                                                        ]
                                                    }),
                                                    selectedProviderPreset.needsBaseUrl ? /*#__PURE__*/ _jsxs("label", {
                                                        className: "wide",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "2. API 地址"
                                                            }),
                                                            /*#__PURE__*/ _jsx("input", {
                                                                value: providerForm.baseUrl,
                                                                onChange: (e)=>{
                                                                    setProviderTestResult('');
                                                                    setProviderForm({
                                                                        ...providerForm,
                                                                        baseUrl: e.target.value
                                                                    });
                                                                },
                                                                placeholder: "粘贴服务商控制台提供的 API 地址"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "可以粘贴根地址或完整接口地址，系统会自动整理。"
                                                            })
                                                        ]
                                                    }) : /*#__PURE__*/ _jsxs("div", {
                                                        className: "provider-fixed-url wide",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: "API 地址（已内置）"
                                                            }),
                                                            /*#__PURE__*/ _jsx("strong", {
                                                                children: providerForm.baseUrl || selectedProviderPreset.baseUrl
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: providerForm.platform === 'agnes' && providerForm.baseUrl && providerForm.baseUrl !== selectedProviderPreset.baseUrl ? "当前保留已选 Agnes 区域地址；请让它与 API Key 所属站点一致。" : "官方地址已经内置，无需填写。"
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("label", {
                                                        className: "wide",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("span", {
                                                                children: [
                                                                    selectedProviderPreset.needsBaseUrl ? '3' : '2',
                                                                    ". API Key"
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx("input", {
                                                                type: "password",
                                                                autoComplete: "off",
                                                                value: providerForm.apiKey,
                                                                onChange: (e)=>{
                                                                    setProviderTestResult('');
                                                                    setProviderForm({
                                                                        ...providerForm,
                                                                        apiKey: e.target.value
                                                                    });
                                                                },
                                                                placeholder: providerEditId ? '留空表示继续使用原密钥' : '粘贴服务商提供的 API Key'
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "密钥会加密保存在本机服务端，网页不会再次显示完整内容。"
                                                            })
                                                        ]
                                                    }),
                                                     providerForm.platform === 'agnes' && /*#__PURE__*/ _jsx(AgnesConnectionGuide, {
                                                         baseUrl: providerForm.baseUrl,
                                                         videoBaseUrl: providerForm.videoBaseUrl,
                                                         savedBaseUrl: state.providers.find((provider)=>provider.id === providerEditId)?.baseUrl || '',
                                                         savedVideoBaseUrl: state.providers.find((provider)=>provider.id === providerEditId)?.videoBaseUrl || '',
                                                         savedKeyMasked: state.providers.find((provider)=>provider.id === providerEditId)?.maskedKey || '',
                                                         hasDraftKey: Boolean(providerForm.apiKey.trim()),
                                                         testResult: providerTestResult,
                                                         onUseDomesticEndpoint: () => applyProviderPreset('agnes')
                                                     }),
                                                     false && /*#__PURE__*/ _jsxs("div", {
                                                        className: "wide provider-video-settings",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "provider-video-settings-head",
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("span", { children: "视频接口（可选）" }),
                                                                    /*#__PURE__*/ _jsx("small", { children: "图片和 Agent 配置不受影响；65535 可直接使用原生任务接口。" })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "provider-video-fields",
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("label", { children: [
                                                                        /*#__PURE__*/ _jsx("span", { children: "传输方式" }),
                                                                        /*#__PURE__*/ _jsx(SelectMenu, { value: providerForm.videoTransport || '', onChange: (value)=>setProviderForm({ ...providerForm, videoTransport: value }), options: [
                                                                            { value: '', label: "未启用视频", description: "暂不启用视频生成" },
                                                                            { value: "native-task", label: "原生异步任务 · 65535", description: "适用于 /v1/tasks 异步接口" },
                                                                            { value: "openai-videos", label: "OpenAI 兼容 · /v1/videos", description: "适用于兼容视频任务接口" },
                                                                            { value: "jimeng-cli", label: "即梦 CLI · 本地调用", description: "使用本机 dreamina CLI" }
                                                                        ], ariaLabel: "视频传输方式" })
                                                                    ] }),
                                                                    /*#__PURE__*/ _jsxs("label", { children: [
                                                                        /*#__PURE__*/ _jsx("span", { children: "独立视频 Key（可选）" }),
                                                                        /*#__PURE__*/ _jsx("input", { type: "password", autoComplete: "off", value: providerForm.videoApiKey || '', onChange: (e)=>setProviderForm({ ...providerForm, videoApiKey: e.target.value }), placeholder: "留空复用主 API Key" })
                                                                    ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "视频 API 地址（可选）" }),
                                                                         /*#__PURE__*/ _jsx("input", { value: providerForm.videoBaseUrl || '', onChange: (e)=>setProviderForm({ ...providerForm, videoBaseUrl: e.target.value }), placeholder: "65535 会自动使用 task-api 地址" })
                                                                     ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "生成路径（可选）" }),
                                                                         /*#__PURE__*/ _jsx("input", { value: providerForm.videoGenerationPath || '', onChange: (e)=>setProviderForm({ ...providerForm, videoGenerationPath: e.target.value }), placeholder: "/v1/videos" })
                                                                     ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "任务状态路径（可选）" }),
                                                                         /*#__PURE__*/ _jsx("input", { value: providerForm.videoTaskStatusPath || '', onChange: (e)=>setProviderForm({ ...providerForm, videoTaskStatusPath: e.target.value }), placeholder: "/v1/videos/{id} 或 /v1/tasks/{id}" })
                                                                     ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "任务提交路径（可选）" }),
                                                                         /*#__PURE__*/ _jsx("input", { value: providerForm.videoTaskPath || '', onChange: (e)=>setProviderForm({ ...providerForm, videoTaskPath: e.target.value }), placeholder: "/v1/tasks" })
                                                                     ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "视频模型路径（可选）" }),
                                                                         /*#__PURE__*/ _jsx("input", { value: providerForm.videoModelsPath || '', onChange: (e)=>setProviderForm({ ...providerForm, videoModelsPath: e.target.value }), placeholder: "/v1/models" })
                                                                     ] }),
                                                                     /*#__PURE__*/ _jsxs("label", { children: [
                                                                         /*#__PURE__*/ _jsx("span", { children: "即梦 CLI 路径（可选）" }),
                                                                        /*#__PURE__*/ _jsx("input", { value: providerForm.jimengCliPath || '', onChange: (e)=>setProviderForm({ ...providerForm, jimengCliPath: e.target.value }), placeholder: "dreamina.cmd 或 dreamina" })
                                                                    ] })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", { className: "provider-video-hint", children: "即梦 CLI 需要先在网页端完成一次视频生成授权；应用不会自动执行远程安装脚本。" }),
                                                            providerForm.videoTransport === 'jimeng-cli' && /*#__PURE__*/ _jsxs("div", {
                                                                className: "jimeng-login-panel",
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        className: "jimeng-login-head",
                                                                        children: [
                                                                            /*#__PURE__*/ _jsxs("div", { children: [
                                                                                /*#__PURE__*/ _jsx("strong", { children: "即梦 CLI 登录" }),
                                                                                /*#__PURE__*/ _jsx("small", { children: providerEditId ? "无需把账号密码交给应用，使用官方设备授权登录。" : "先保存服务配置，再开始设备授权登录。" })
                                                                            ] }),
                                                                            /*#__PURE__*/ _jsx("a", { href: "https://bytedance.larkoffice.com/wiki/FVTwwm0bGiishxkKOoScdHR2nsg", target: "_blank", rel: "noreferrer", children: "官方安装与登录说明 ↗" })
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        className: "jimeng-login-actions",
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("button", { type: "button", className: "secondary-action", disabled: !providerEditId || jimengLogin.status === 'inspecting', onClick: () => void jimengLoginAction('inspect'), children: jimengLogin.status === 'inspecting' ? "检测中…" : "检测 CLI" }),
                                                                            /*#__PURE__*/ _jsx("button", { type: "button", className: "secondary-action", disabled: !providerEditId || jimengLogin.status === 'starting', onClick: () => void jimengLoginAction('start'), children: jimengLogin.status === 'starting' ? "获取授权码…" : "开始即梦登录" })
                                                                        ]
                                                                    }),
                                                                    jimengLogin.version && /*#__PURE__*/ _jsx("small", { className: "jimeng-login-note success", children: `已检测到 ${jimengLogin.version}` }),
                                                                    jimengLogin.verificationUri && /*#__PURE__*/ _jsxs("div", { className: "jimeng-login-code-card", children: [
                                                                        /*#__PURE__*/ _jsxs("div", { children: [
                                                                            /*#__PURE__*/ _jsx("span", { children: "1 · 打开授权页面" }),
                                                                            /*#__PURE__*/ _jsx("a", { href: jimengLogin.verificationUri, target: "_blank", rel: "noreferrer", children: jimengLogin.verificationUri })
                                                                        ] }),
                                                                        /*#__PURE__*/ _jsxs("div", { children: [
                                                                            /*#__PURE__*/ _jsx("span", { children: "2 · 输入授权码" }),
                                                                            /*#__PURE__*/ _jsx("b", { children: jimengLogin.userCode || "—" })
                                                                        ] }),
                                                                        /*#__PURE__*/ _jsx("button", { type: "button", className: "primary-action compact", disabled: jimengLogin.status === 'checking', onClick: () => void jimengLoginAction('check'), children: jimengLogin.status === 'checking' ? "检查中…" : "检查授权" })
                                                                    ] }),
                                                                     jimengLogin.message && /*#__PURE__*/ _jsx("small", { className: `jimeng-login-note ${jimengLogin.status === 'authorized' ? 'success' : ''}`, children: jimengLogin.message }),
                                                                     /*#__PURE__*/ _jsx(JimengAccountSummary, { account: jimengLogin.account, checkedAt: jimengLogin.accountCheckedAt, error: jimengLogin.accountError, loading: jimengLogin.status === 'accounting', onRefresh: providerEditId ? () => void jimengLoginAction('refresh-account') : undefined }),
                                                                     jimengLogin.error && /*#__PURE__*/ _jsx("small", { className: "jimeng-login-note error", children: jimengLogin.error })
                                                                ]
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }),
                                            providerTestResult && /*#__PURE__*/ _jsx("div", {
                                                className: `connection-result ${providerTestResult.startsWith('连接成功') ? 'success' : 'error'}`,
                                                children: providerTestResult
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "form-actions provider-simple-actions",
                                                children: [
                                                    /*#__PURE__*/ _jsx("button", {
                                                        type: "button",
                                                        className: "secondary-action",
                                                        disabled: providerBusy || providerTestBusy || providerForm.videoTransport !== 'jimeng-cli' && (!providerForm.baseUrl.trim() || !providerForm.apiKey.trim() && !providerEditId),
                                                        onClick: ()=>void testProvider(),
                                                        children: providerTestBusy ? '正在测试…' : '只测试连接'
                                                    }),
                                                    /*#__PURE__*/ _jsx("button", {
                                                        className: "primary-action compact",
                                                        disabled: providerBusy || providerTestBusy || providerForm.videoTransport !== 'jimeng-cli' && (!providerForm.baseUrl.trim() || !providerForm.apiKey.trim() && !providerEditId),
                                                        children: providerBusy ? '正在测试并连接…' : providerEditId ? '测试并保存' : '测试并连接'
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsx("div", {
                                        className: "provider-list",
                                        // Jimeng is managed by the dedicated local CLI card above;
                                        // keeping it out of the generic provider list avoids two
                                        // competing connection flows for the same account.
                                        children: state.providers.filter((provider)=>provider.platform !== 'jimeng-cli' && provider.videoTransport !== 'jimeng-cli').map((provider)=>/*#__PURE__*/ _jsxs("article", {
                                                className: `provider-card surface ${providerEditId === provider.id ? 'editing' : ''}`,
                                                "aria-current": providerEditId === provider.id || undefined,
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "provider-logo",
                                                        children: platformLabel(provider.platform).slice(0, 2)
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "provider-content",
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                children: [
                                                                    /*#__PURE__*/ _jsx("strong", {
                                                                        children: provider.name
                                                                    }),
                                                                     /*#__PURE__*/ _jsx("span", {
                                                                         className: "provider-platform",
                                                                         children: platformLabel(provider.platform)
                                                                     }),
                                                                     provider.platform === 'agnes' && /*#__PURE__*/ _jsx("span", {
                                                                         className: `provider-credential-badge ${provider.credentialVerifiedAt ? 'verified' : 'unverified'}`,
                                                                         children: provider.credentialVerifiedAt ? '上次验证通过' : '待验证 Key'
                                                                     }),
                                                                     /*#__PURE__*/ _jsx("span", {
                                                                         className: `provider-status ${provider.status}`,
                                                                        children: provider.status === 'healthy' ? '连接正常' : provider.status === 'error' ? '连接异常' : '待读取'
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("label", {
                                                                        className: "provider-library-toggle",
                                                                        title: isProviderModelLibraryEnabled(provider) ? '取消后隐藏并停用该服务商模型；不会清除模型勾选状态' : '加入模型库并恢复该服务商模型的上次勾选状态',
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("input", {
                                                                                type: "checkbox",
                                                                                "aria-label": `${isProviderModelLibraryEnabled(provider) ? '隐藏' : '加入'} ${provider.name} 的模型库`,
                                                                                checked: isProviderModelLibraryEnabled(provider),
                                                                                onChange: ()=>void toggleProviderModelLibrary(provider)
                                                                            }),
                                                                            /*#__PURE__*/ _jsx("span", {
                                                                                children: isProviderModelLibraryEnabled(provider) ? '已加入模型库' : '已隐藏'
                                                                            })
                                                                        ]
                                                                    }),
                                                                    providerEditId === provider.id && /*#__PURE__*/ _jsxs("span", {
                                                                        className: "provider-editing-badge",
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                                name: "edit",
                                                                                size: 10
                                                                            }),
                                                                            "正在编辑"
                                                                        ]
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("p", {
                                                                children: [
                                                                    typeLabel(provider.type),
                                                                    " \xb7 ",
                                                                    provider.baseUrl
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsxs("small", {
                                                                children: [
                                                                    "密钥 ",
                                                                    provider.maskedKey,
                                                                    " \xb7 已选择 ",
                                                                    provider.enabledModelCount,
                                                                    " 个模型 \xb7 最近读取 ",
                                                                    provider.lastSyncedAt || '—'
                                                                ]
                                                            })
                                                        ]
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        className: "provider-card-actions",
                                                        children: [
                                                            /*#__PURE__*/ _jsx("button", {
                                                                onClick: ()=>openEditProvider(provider),
                                                                children: "修改"
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                onClick: ()=>void syncProvider(provider.id),
                                                                disabled: syncingId === provider.id,
                                                                children: syncingId === provider.id ? '读取中…' : '重新读取模型'
                                                            }),
                                                            /*#__PURE__*/ _jsx("button", {
                                                                className: "danger",
                                                                onClick: ()=>askDeleteProvider(provider.id),
                                                                children: "删除"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }, provider.id))
                                    })
                                ]
                            })),
                            section === 'models' && (adminRequired && !isAdmin ? /*#__PURE__*/ _jsx(AdminLogin, {
                                password: adminPassword,
                                setPassword: setAdminPassword,
                                busy: adminBusy,
                                onSubmit: loginAdmin
                            }) : /*#__PURE__*/ _jsxs("section", {
                                className: "management-page models-page",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "management-head",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("h1", {
                                                        children: "模型库"
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        children: "模型读取回来后，不需要“启用 + 发布”两步。直接勾选“使用”，它就会出现在助手或生图页面的模型下拉菜单里。"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "management-actions",
                                                children: [
                                                    /*#__PURE__*/ _jsxs("button", {
                                                        className: "ghost-button",
                                                        onClick: ()=>setSection('providers'),
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Icon, {
                                                                name: "plug",
                                                                size: 15
                                                            }),
                                                            "管理接口服务"
                                                        ]
                                                    }),
                                                    adminRequired && /*#__PURE__*/ _jsx("button", {
                                                        className: "ghost-button",
                                                        onClick: ()=>void logoutAdmin(),
                                                        children: "退出管理"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "default-models surface",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "默认助手模型"
                                                    }),
                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                        value: state.settings.agentModelId || '',
                                                        options: availableChatModels.map((m)=>({
                                                                value: m.id,
                                                                label: m.displayName,
                                                                meta: m.providerName
                                                            })),
                                                        onChange: (v)=>void patchSettings({
                                                                agentModelId: v
                                                            }),
                                                        placeholder: "选择对话模型"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "默认图片模型"
                                                    }),
                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                        value: state.settings.defaultImageModelId || '',
                                                        options: availableGenerationModels.map((m)=>({
                                                                value: m.id,
                                                                label: m.displayName,
                                                                meta: m.providerName
                                                            })),
                                                        onChange: (v)=>void patchSettings({
                                                                defaultImageModelId: v
                                                            }),
                                                        placeholder: "选择生图模型"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", { children: "默认视频模型" }),
                                                    /*#__PURE__*/ _jsx(Dropdown, {
                                                        value: state.settings.defaultVideoModelId || '',
                                                        options: availableVideoModels.map((m)=>( { value: m.id, label: m.displayName, meta: m.providerName } )),
                                                        onChange: (v)=>void patchSettings({ defaultVideoModelId: v }),
                                                        placeholder: "选择视频模型"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "model-library-default-provider",
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "默认厂商"
                                                    }),
                                                    /*#__PURE__*/ _jsxs("div", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx(Dropdown, {
                                                                value: state.settings.defaultProviderId || '',
                                                                options: [
                                                                    {
                                                                        value: '',
                                                                        label: '自动 · 不指定厂商',
                                                                        meta: '按可用模型自动回退'
                                                                    },
...state.providers.filter((provider)=>isProviderModelLibraryEnabled(provider)).map((provider)=>({
                                                                            value: provider.id,
                                                                            label: provider.name,
meta: `${activeProviderModels.filter((model)=>model.providerId === provider.id && model.enabled && model.published).length} 个可用模型`
                                                                        }))
                                                                ],
                                                                onChange: (value)=>void patchSettings({
                                                                        defaultProviderId: value || null
                                                                    }),
                                                                placeholder: "自动 \xb7 不指定厂商"
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: "自动模式优先使用这里指定的厂商；手动选择模型时不受影响。"
                                                            })
                                                        ]
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "model-toolbar surface",
                                        children: [
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "search-box",
                                                children: [
                                                    /*#__PURE__*/ _jsx(Icon, {
                                                        name: "search",
                                                        size: 17
                                                    }),
                                                    /*#__PURE__*/ _jsx("input", {
                                                        value: modelSearch,
                                                        onChange: (e)=>setModelSearch(e.target.value),
                                                        placeholder: "搜索模型名称…"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsx(Dropdown, {
                                                value: modelProviderFilter,
                                                options: [
                                                    {
                                                        value: 'all',
                                                        label: '全部接口服务'
                                                    },
                                                     ...state.providers.filter((p)=>isProviderModelLibraryEnabled(p)).map((p)=>({
                                                             value: p.id,
                                                             label: p.name,
                                                             meta: `${activeProviderModels.filter((m)=>m.providerId === p.id).length} 个模型`
                                                         }))
                                                ],
                                                onChange: setModelProviderFilter,
                                                className: "provider-filter"
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                className: "model-count",
                                                children: [
                                                    "已选择 ",
                                                    /*#__PURE__*/ _jsx("strong", {
                                                    children: availableChatModels.length + availableImageModels.length + availableVideoModels.length
                                                    }),
                                                    " / ",
                                                     activeProviderModels.length
                                                ]
                                            })
                                        ]
                                    }),
                                    !activeProviderModels.length ? /*#__PURE__*/ _jsxs("div", {
                                        className: "history-empty",
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "empty-icon",
                                                children: /*#__PURE__*/ _jsx(Icon, {
                                                    name: "model",
                                                    size: 28
                                                })
                                            }),
                                            /*#__PURE__*/ _jsx("h2", {
                                                 children: state.models.length ? "还没有加入模型库的模型" : "还没有读取模型"
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                 children: state.models.length ? "请先在接口服务中勾选要加入模型库的服务商。" : "先添加接口服务，再读取它提供的模型列表。"
                                            }),
                                            /*#__PURE__*/ _jsx("button", {
                                                className: "primary-action compact",
                                                onClick: ()=>setSection('providers'),
                                                children: "去添加接口服务"
                                            })
                                        ]
                                    }) : /*#__PURE__*/ _jsxs(_Fragment, {
                                        children: [
                                            /*#__PURE__*/ _jsx("div", {
                                                className: "model-kind-tabs surface",
                                                children: [
                                                    [
                                                        'all',
                                                        '全部模型'
                                                    ],
                                                    [
                                                        'chat',
                                                        '对话模型'
                                                    ],
                                                    [
                                                        'image',
                                                        '图片模型'
                                                    ],
                                                    [
                                                        'video',
                                                        '视频模型'
                                                    ],
                                                    [
                                                        'unknown',
                                                        '未分类'
                                                    ]
                                                ].map(([kind, label])=>/*#__PURE__*/ _jsxs("button", {
                                                        className: modelKindFilter === kind ? 'active' : '',
                                                        onClick: ()=>setModelKindFilter(kind),
                                                        children: [
                                                            /*#__PURE__*/ _jsx("span", {
                                                                children: label
                                                            }),
                                                            /*#__PURE__*/ _jsx("b", {
                                                                children: modelKindCounts[kind]
                                                            })
                                                        ]
                                                    }, kind))
                                            }),
                                            !visibleModels.length ? /*#__PURE__*/ _jsxs("div", {
                                                className: "history-empty compact-empty",
                                                children: [
                                                    /*#__PURE__*/ _jsx("div", {
                                                        className: "empty-icon",
                                                        children: /*#__PURE__*/ _jsx(Icon, {
                                                            name: "search",
                                                            size: 25
                                                        })
                                                    }),
                                                    /*#__PURE__*/ _jsx("h2", {
                                                        children: "没有符合条件的模型"
                                                    }),
                                                    /*#__PURE__*/ _jsx("p", {
                                                        children: "换个服务商、关键词或分类试试。"
                                                    })
                                                ]
                                            }) : /*#__PURE__*/ _jsx("div", {
                                                className: "model-groups",
                                                children: modelProviderGroups.map(([providerId, group])=>{
                                                    const expanded = Boolean(modelSearch.trim()) || expandedModelProviders.has(providerId);
                                                    return /*#__PURE__*/ _jsxs("section", {
                                                        className: `model-group ${expanded ? 'expanded' : ''}`,
                                                        children: [
                                                            /*#__PURE__*/ _jsxs("div", {
                                                                className: "model-group-head",
                                                                role: "button",
                                                                tabIndex: 0,
                                                                "aria-expanded": expanded,
                                                                onClick: ()=>toggleModelProviderGroup(providerId),
                                                                onKeyDown: (event)=>{
                                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                                        event.preventDefault();
                                                                        toggleModelProviderGroup(providerId);
                                                                    }
                                                                },
                                                                children: [
                                                                    /*#__PURE__*/ _jsxs("div", {
                                                                        children: [
                                                                            /*#__PURE__*/ _jsx("h2", {
                                                                                children: group[0].providerName
                                                                            }),
                                                                            /*#__PURE__*/ _jsxs("p", {
                                                                                children: [
                                                                                    group.filter((model)=>model.kind === 'chat').length ? '对话' : '',
                                                                                    group.filter((model)=>model.kind === 'chat').length && group.filter((model)=>model.kind === 'image').length ? ' · ' : '',
                                                                                    group.filter((model)=>model.kind === 'image').length ? '图片' : '',
                                                                                    group.filter((model)=>model.kind === 'video').length ? ' · 视频' : '',
                                                                                    group.some((model)=>model.kind === 'unknown') ? ' · 待归类' : ''
                                                                                ]
                                                                            })
                                                                        ]
                                                                    }),
                                                                    /*#__PURE__*/ _jsxs("span", {
                                                                        children: [
                                                                            group.length,
                                                                            " 个 \xb7 ",
                                                                            group.filter((model)=>model.enabled && model.published).length,
                                                                            " 个已启用"
                                                                        ]
                                                                    })
                                                                ]
                                                            }),
                                                            /*#__PURE__*/ _jsx("div", {
                                                                className: "model-cards",
                                                                children: expanded && group.map(renderModelCard)
                                                            })
                                                        ]
                                                    }, providerId);
                                                })
                                            })
                                        ]
                                    }),
                                    activeProviderModels.length > 0 && /*#__PURE__*/ _jsxs("nav", {
                                        className: "model-page-scroll-nav",
                                        "aria-label": "模型库页面导航",
                                        children: [
                                            /*#__PURE__*/ _jsxs("button", {
                                                type: "button",
                                                onClick: ()=>scrollModelLibrary('top'),
                                                title: "跳到顶部",
                                                "aria-label": "跳到模型库顶部",
                                                children: [
                                                    /*#__PURE__*/ _jsx("b", {
                                                        "aria-hidden": "true",
                                                        children: "↑"
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "顶部"
                                                    })
                                                ]
                                            }),
                                            /*#__PURE__*/ _jsxs("button", {
                                                type: "button",
                                                onClick: ()=>scrollModelLibrary('bottom'),
                                                title: "跳到底部",
                                                "aria-label": "跳到模型库底部",
                                                children: [
                                                    /*#__PURE__*/ _jsx("b", {
                                                        "aria-hidden": "true",
                                                        children: "↓"
                                                    }),
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "底部"
                                                    })
                                                ]
                                            })
                                        ]
                                    })
                                ]
                            }))
                        ]
                    })
                ]
            }),
            selectedLog && /*#__PURE__*/ _jsx("div", {
                className: "log-detail-backdrop",
                onClick: ()=>setSelectedLog(null),
                children: /*#__PURE__*/ _jsxs("aside", {
                    className: "log-detail-panel",
                    onClick: (e)=>e.stopPropagation(),
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "log-detail-head",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "生成任务详情"
                                        }),
                                        /*#__PURE__*/ _jsx("h2", {
                                            children: selectedLog.status === 'pending' ? '正在生成' : selectedLog.status === 'success' ? '生成成功' : '生成失败'
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    className: "icon-button",
                                    onClick: ()=>setSelectedLog(null),
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close"
                                    })
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "log-detail-status",
                            children: [
                                /*#__PURE__*/ _jsx("b", {
                                    className: selectedLog.status,
                                    children: selectedLog.status === 'pending' ? '进行中' : selectedLog.status === 'success' ? '成功' : '失败'
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                    children: new Date(selectedLog.createdAt).toLocaleString('zh-CN', {
                                        hour12: false
                                    })
                                })
                            ]
                        }),
                        generationMediaKind(selectedLog) === 'video' && selectedLog.videoUrls?.length ? /*#__PURE__*/ _jsx("div", {
                            className: "log-detail-video",
                            children: /*#__PURE__*/ _jsx("video", { src: selectedLog.videoUrls[0], controls: true, playsInline: true, preload: "metadata" })
                        }) : selectedLog.imageUrls?.length ? /*#__PURE__*/ _jsx("div", {
                            className: "log-detail-images",
                            children: selectedLog.imageUrls.map((url, index)=>/*#__PURE__*/ _jsx("a", {
                                    href: url,
                                    target: "_blank",
                                    rel: "noreferrer",
                                    onClick: ()=>markHistoryNoticeSeen(),
                                    children: /*#__PURE__*/ _jsx("img", {
                                        src: url,
                                        alt: `生成结果 ${index + 1}`
                                    })
                                }, `${url}-${index}`))
                        }) : /*#__PURE__*/ _jsxs("div", {
                            className: `log-detail-empty ${selectedLog.status === 'pending' ? 'pending' : ''}`,
                            children: [
                                selectedLog.status === 'pending' ? /*#__PURE__*/ _jsx("span", {
                                    className: "loading-orb"
                                }) : /*#__PURE__*/ _jsx(Icon, {
                                    name: generationMediaKind(selectedLog) === 'video' ? 'video' : generationMediaKind(selectedLog) === 'audio' ? 'audio' : 'image',
                                    size: 24
                                }),
                                /*#__PURE__*/ _jsx("span", {
                                    children: selectedLog.status === 'pending' ? `${generationMediaLabel(generationMediaKind(selectedLog))}生成中，完成后会自动更新` : `没有可预览的${generationMediaLabel(generationMediaKind(selectedLog))}`
                                })
                            ]
                        }),
                        selectedLog.references?.length ? /*#__PURE__*/ _jsxs("section", {
                            className: "log-detail-references",
                            children: [
                                /*#__PURE__*/ _jsx("h3", {
                                    children: `本次参考图（按提交顺序 · ${selectedLog.references.length} 张）`
                                }),
                                /*#__PURE__*/ _jsx("div", {
                                    className: "log-reference-list",
                                    children: selectedLog.references.map((reference, index)=>/*#__PURE__*/ _jsxs("a", {
                                        href: reference.url || undefined,
                                        target: reference.url ? "_blank" : undefined,
                                        rel: reference.url ? "noreferrer" : undefined,
                                        className: reference.url ? '' : 'unavailable',
                                        children: [
                                            reference.url ? /*#__PURE__*/ _jsx("img", {
                                                src: reference.url,
                                                alt: `参考图 ${index + 1}`
                                            }) : /*#__PURE__*/ _jsx("span", {
                                                className: "log-reference-placeholder",
                                                children: "—"
                                            }),
                                            /*#__PURE__*/ _jsxs("span", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("b", {
                                                        children: `图 ${index + 1}`
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: reference.name
                                                    })
                                                ]
                                            })
                                        ]
                                    }, `${reference.url}-${index}`))
                                })
                            ]
                        }) : null,
                        /*#__PURE__*/ _jsxs("dl", {
                            className: "log-detail-fields",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "提示词"
                                        }),
                                        /*#__PURE__*/ _jsxs("dd", {
                                            className: "log-detail-prompt",
                                            children: [
                                                /*#__PURE__*/ _jsx("span", {
                                                    children: selectedLog.prompt || '未填写'
                                                }),
                                                /*#__PURE__*/ _jsxs("button", {
                                                    type: "button",
                                                    className: "log-copy-prompt",
                                                    disabled: !selectedLog.prompt,
                                                    onClick: ()=>void copyPrompt(selectedLog.prompt),
                                                    children: [
                                                        /*#__PURE__*/ _jsx(Icon, {
                                                            name: "copy",
                                                            size: 14
                                                        }),
                                                        "复制提示词"
                                                    ]
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "模型"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: selectedLog.modelName || (selectedLog.status === 'pending' ? '自动选择中' : '未指定')
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "服务商"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: selectedLog.providerName || (selectedLog.status === 'pending' ? '等待响应' : '未指定')
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "类型"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: generationLogSourceLabel(selectedLog)
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "耗时"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: selectedLog.status === 'pending' ? `${Math.max(.1, (generateClock - new Date(selectedLog.createdAt).getTime()) / 1000).toFixed(1)} 秒（进行中）` : selectedLog.durationMs ? `${(selectedLog.durationMs / 1000).toFixed(1)} 秒` : '—'
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: generationMediaKind(selectedLog) === 'video' ? "视频数量" : generationMediaKind(selectedLog) === 'audio' ? "音频数量" : "图片数量"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: generationMediaKind(selectedLog) === 'video' ? `${selectedLog.videoUrls?.length || (selectedLog.status === 'pending' ? 1 : 0)} 段` : generationMediaKind(selectedLog) === 'audio' ? '1 段' : selectedLog.status === 'pending' ? `预计 ${selectedLog.count ?? 1} 张` : `${selectedLog.imageCount ?? 0} 张`
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "分辨率"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: generationMediaKind(selectedLog) === 'video' ? (selectedLog.resolution || '自动') : generationMediaKind(selectedLog) === 'audio' ? '音频参数见任务输入' : logResolutionLabel(selectedLog, logImageSpecs[selectedLog.id])
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: generationMediaKind(selectedLog) === 'video' ? "视频比例"
                                                : generationMediaKind(selectedLog) === 'audio' ? "音频时长" : "图片尺寸"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: generationMediaKind(selectedLog) === 'video' ? (selectedLog.aspectRatio || '自动') : generationMediaKind(selectedLog) === 'audio' ? (selectedLog.durationMs ? `${(selectedLog.durationMs / 1000).toFixed(1)} 秒` : '—') : logOutputSizeLabel(selectedLog, logImageSpecs[selectedLog.id])
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: generationMediaKind(selectedLog) === 'video' ? "视频操作" : generationMediaKind(selectedLog) === 'audio' ? "音频格式" : "图片比例"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: generationMediaKind(selectedLog) === 'video' ? (selectedLog.operation === 'edit' ? '编辑' : selectedLog.operation === 'extend' ? '扩展' : '生成') : generationMediaKind(selectedLog) === 'audio' ? '—' : logAspectRatioLabel(selectedLog, logImageSpecs[selectedLog.id])
                                        })
                                    ]
                                }),
                                selectedLog.storagePath && /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "存储路径"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            children: selectedLog.storagePath
                                        })
                                    ]
                                }),
                                selectedLog.providerTaskId && /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", { children: "服务商任务 ID" }),
                                        /*#__PURE__*/ _jsx("dd", { children: selectedLog.providerTaskId })
                                    ]
                                }),
                                typeof selectedLog.costUsd === 'number' && /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", { children: "费用" }),
                                        /*#__PURE__*/ _jsx("dd", { children: `$${selectedLog.costUsd.toFixed(4)}` })
                                    ]
                                }),
                                selectedLog.error && /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("dt", {
                                            children: "错误信息"
                                        }),
                                        /*#__PURE__*/ _jsx("dd", {
                                            className: "log-error",
                                            children: selectedLog.error
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                })
            }),
            viewerItem && /*#__PURE__*/ _jsx("div", {
                className: "viewer-backdrop",
                onClick: ()=>setViewerId(null),
                children: /*#__PURE__*/ _jsxs("div", {
                    className: "viewer",
                    onClick: (e)=>e.stopPropagation(),
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "viewer-top",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("strong", {
                                            children: viewerItem.modelName || '生成图片'
                                        }),
                                        /*#__PURE__*/ _jsxs("small", {
                                            children: [
                                                sourceLabel(viewerItem.source),
                                                " \xb7 ",
                                                viewerItem.outputSize || viewerItem.aspectRatio || '自动',
                                                " \xb7 ",
                                                formatTime(viewerItem.createdAt)
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "viewer-top-actions",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "zoom-controls",
                                            children: [
                                                /*#__PURE__*/ _jsx("button", {
                                                    title: "缩小",
                                                    onClick: ()=>adjustViewerZoom(viewerZoom - 0.1),
                                                    children: /*#__PURE__*/ _jsx(Icon, {
                                                        name: "zoomOut",
                                                        size: 16
                                                    })
                                                }),
                                                /*#__PURE__*/ _jsxs("span", {
                                                    className: "zoom-readout",
                                                    children: [
                                                        Math.round(viewerZoom * 100),
                                                        "%"
                                                    ]
                                                }),
                                                /*#__PURE__*/ _jsx("button", {
                                                    className: "zoom-reset",
                                                    title: "恢复原比例",
                                                    onClick: resetViewerView,
                                                    children: "原比例"
                                                }),
                                                /*#__PURE__*/ _jsx("button", {
                                                    title: "放大",
                                                    onClick: ()=>adjustViewerZoom(viewerZoom + 0.1),
                                                    children: /*#__PURE__*/ _jsx(Icon, {
                                                        name: "zoomIn",
                                                        size: 16
                                                    })
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            className: "icon-button",
                                            onClick: ()=>setViewerId(null),
                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                name: "close"
                                            })
                                        })
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "viewer-stage-wrap",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    className: `viewer-stage ${viewerZoom > 1 ? 'can-drag' : ''} ${viewerDragging ? 'dragging' : ''}`,
                                    ref: viewerStageRef,
                                    onWheel: handleViewerWheel,
                                    onPointerDown: handleViewerPointerDown,
                                    onPointerMove: handleViewerPointerMove,
                                    onPointerUp: handleViewerPointerUp,
                                    onPointerCancel: handleViewerPointerUp,
                                    children: [
                                        /*#__PURE__*/ _jsx("div", {
                                            className: "viewer-canvas",
                                            children: /*#__PURE__*/ _jsx("img", {
                                                draggable: false,
                                                src: viewerItem.url,
                                                alt: viewerItem.prompt,
                                                onLoad: (e)=>setViewerImageSize({
                                                        width: e.currentTarget.naturalWidth,
                                                        height: e.currentTarget.naturalHeight
                                                    }),
                                                style: viewerDisplaySize.width ? {
                                                    width: viewerDisplaySize.width,
                                                    height: viewerDisplaySize.height,
                                                    transform: `translate3d(${viewerPan.x}px, ${viewerPan.y}px, 0)`
                                                } : undefined
                                            })
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "wheel-tip",
                                            children: [
                                                "滚轮缩放",
                                                viewerZoom > 1 ? ' · 按住图片拖动查看' : '',
                                                " \xb7 点击百分比恢复完整画面"
                                            ]
                                        })
                                    ]
                                }),
                                viewerItems.length > 1 && /*#__PURE__*/ _jsxs(_Fragment, {
                                    children: [
                                        /*#__PURE__*/ _jsx("button", {
                                            className: "viewer-nav prev",
                                            disabled: viewerIndex <= 0,
                                            onClick: ()=>openViewer(viewerItems[Math.max(0, viewerIndex - 1)] || viewerItem),
                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                name: "left"
                                            })
                                        }),
                                        /*#__PURE__*/ _jsx("button", {
                                            className: "viewer-nav next",
                                            disabled: viewerIndex >= viewerItems.length - 1,
                                            onClick: ()=>openViewer(viewerItems[Math.min(viewerItems.length - 1, viewerIndex + 1)] || viewerItem),
                                            children: /*#__PURE__*/ _jsx(Icon, {
                                                name: "right"
                                            })
                                        })
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "viewer-info",
                            children: [
                                /*#__PURE__*/ _jsx("p", {
                                    children: viewerItem.prompt
                                }),
                                viewerItem.revisedPrompt && viewerItem.revisedPrompt !== viewerItem.prompt && /*#__PURE__*/ _jsxs("details", {
                                    children: [
                                        /*#__PURE__*/ _jsx("summary", {
                                            children: "查看模型改写后的提示词"
                                        }),
                                        /*#__PURE__*/ _jsx("p", {
                                            children: viewerItem.revisedPrompt
                                        })
                                    ]
                                }),
                                viewerReferences.length ? /*#__PURE__*/ _jsxs("section", {
                                    className: "viewer-reference-panel",
                                    children: [
                                        /*#__PURE__*/ _jsxs("div", {
                                            className: "viewer-reference-head",
                                            children: [
                                                /*#__PURE__*/ _jsx("strong", {
                                                    children: `参考图（按提交顺序 · ${viewerReferences.length} 张）`
                                                }),
                                                /*#__PURE__*/ _jsx("small", {
                                                    children: "分享版会包含全部参考图"
                                                })
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsx("div", {
                                            className: "viewer-reference-list",
                                            children: viewerReferences.map((reference, index)=>/*#__PURE__*/ _jsxs("a", {
                                                href: reference.url,
                                                target: "_blank",
                                                rel: "noreferrer",
                                                title: reference.name,
                                                children: [
                                                    /*#__PURE__*/ _jsx("img", {
                                                        src: reference.url,
                                                        alt: `参考图 ${index + 1}`
                                                    }),
                                                    /*#__PURE__*/ _jsxs("span", {
                                                        children: [
                                                            /*#__PURE__*/ _jsx("b", {
                                                                children: `图 ${index + 1}`
                                                            }),
                                                            /*#__PURE__*/ _jsx("small", {
                                                                children: reference.name
                                                            })
                                                        ]
                                                    })
                                                ]
                                            }, `${reference.url}-${index}`))
                                        })
                                    ]
                                }) : null,
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "viewer-actions",
                                    children: [
                                        viewerParentItem && /*#__PURE__*/ _jsxs("button", {
                                            className: "compare-primary",
                                            onClick: ()=>openCompare(viewerItem),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "compare",
                                                    size: 15
                                                }),
                                                "前后对比"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            className: "angle-viewer-action",
                                            onClick: ()=>{
                                                void openAngleConsole(viewerItem);
                                                setViewerId(null);
                                            },
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "adjust",
                                                    size: 15
                                                }),
                                                "调整角度"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            onClick: ()=>openEdit(viewerItem),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "edit",
                                                    size: 15
                                                }),
                                                "修改"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            className: "upscale-primary",
                                            onClick: ()=>openUpscale(viewerItem),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "upscale",
                                                    size: 15
                                                }),
                                                "高清放大"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            className: "reference-primary",
                                            onClick: ()=>useAsReference(viewerItem),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "image",
                                                    size: 15
                                                }),
                                                "作为参考图"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            onClick: ()=>reuseItem(viewerItem),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "reuse",
                                                    size: 15
                                                }),
                                                "用此参数再生成"
                                            ]
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            className: "download-primary",
                                            onClick: ()=>void downloadUrl(viewerItem.url, `SANMAO-${viewerItem.id}.png`),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "download",
                                                    size: 15
                                                }),
                                                "下载原图"
                                            ]
                                        }),
                                        viewerReferences.length ? /*#__PURE__*/ _jsxs("button", {
                                            className: "download-share-primary",
                                            onClick: ()=>void downloadShareImage(viewerItem).catch((error)=>notify(error instanceof Error ? error.message : '分享版下载失败')),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "download",
                                                    size: 15
                                                }),
                                                "下载分享版"
                                            ]
                                        }) : null,
                                        /*#__PURE__*/ _jsxs("button", {
                                            className: "danger",
                                            onClick: ()=>askDeleteItems([
                                                    viewerItem.id
                                                ]),
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "trash",
                                                    size: 15
                                                }),
                                                "删除"
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                })
            }),
            compareState && /*#__PURE__*/ _jsx(CompareViewer, {
                item: compareState.item,
                source: compareState.source,
                parent: compareState.parent,
                onClose: ()=>setCompareState(null)
            }),
            editor && /*#__PURE__*/ _jsx(EditorModal, {
                editor: editor,
                editModelOptions: availableEditModels,
                upscaleModelOptions: availableUpscaleModels,
                defaultUpscaleModel: defaultUpscaleModel,
                defaultProviderId: state.settings.defaultProviderId,
                defaultProviderName: defaultProvider?.name,
                defaultImageModelId: state.settings.defaultImageModelId,
                upscaleSourceSize: upscaleSourceSize,
                upscaleTargetPreview: upscaleTargetPreview,
                onChange: (next)=>setEditor(next),
                onClose: ()=>{
                    setEditorMaskOpen(false);
                    setEditor(null);
                },
                onMaskEdit: ()=>setEditorMaskOpen(true),
                onOpenProviders: ()=>{
                    setEditorMaskOpen(false);
                    setEditor(null);
                    setSection('providers');
                },
                onSubmit: runEditor
            }),
            editorMaskOpen && editor?.mode === 'edit' && /*#__PURE__*/ _jsx(MaskEditor, {
                imageUrl: editor.item.url,
                initialMaskDataUrl: editor.mask || undefined,
                onCancel: ()=>setEditorMaskOpen(false),
                onApply: (dataUrl)=>{
                    setEditor((current)=>current ? {
                            ...current,
                            mask: dataUrl
                        } : current);
                    setEditorMaskOpen(false);
                    notify('蒙版已设置，提交修改时会一并发送');
                }
            }),
            selectionPush && section === 'agent' && /*#__PURE__*/ _jsxs("div", {
                className: `selection-push ${selectionPush.placement === 'below' ? 'below' : 'above'}`,
                style: {
                    left: selectionPush.x,
                    top: selectionPush.y
                },
                onMouseDown: (e)=>e.preventDefault(),
                children: [
                    /*#__PURE__*/ _jsxs("section", {
                        className: "selection-push-group image",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "selection-push-group-title",
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "image",
                                        size: 13
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "图片生成"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "selection-push-group-actions",
                                children: [
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "selection-push-jump",
                                        title: "带入图片提示词并跳转",
                                        onClick: ()=>pushTextToGenerate(selectionPush.text, true),
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "send",
                                                size: 12
                                            }),
                                            "送入并跳转"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "selection-push-stay",
                                        title: "追加到图片提示词，留在当前页面",
                                        onClick: ()=>pushTextToGenerate(selectionPush.text, false),
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "plus",
                                                size: 12
                                            }),
                                            "继续选择"
                                        ]
                                    })
                                ]
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsxs("section", {
                        className: "selection-push-group video",
                        children: [
                            /*#__PURE__*/ _jsxs("div", {
                                className: "selection-push-group-title",
                                children: [
                                    /*#__PURE__*/ _jsx(Icon, {
                                        name: "video",
                                        size: 13
                                    }),
                                    /*#__PURE__*/ _jsx("span", {
                                        children: "视频生成"
                                    }),
                                    !availableVideoModels.length && /*#__PURE__*/ _jsx("small", {
                                        children: "请先启用模型"
                                    })
                                ]
                            }),
                            /*#__PURE__*/ _jsxs("div", {
                                className: "selection-push-group-actions",
                                children: [
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "selection-push-jump",
                                        title: availableVideoModels.length ? "带入视频提示词并跳转" : "请先在模型库启用视频模型",
                                        disabled: !availableVideoModels.length,
                                        onClick: ()=>pushTextToVideo(selectionPush.text, true),
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "send",
                                                size: 12
                                            }),
                                            "送入并跳转"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "selection-push-stay",
                                        title: availableVideoModels.length ? "追加到视频提示词，留在当前页面" : "请先在模型库启用视频模型",
                                        disabled: !availableVideoModels.length,
                                        onClick: ()=>pushTextToVideo(selectionPush.text, false),
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "plus",
                                                size: 12
                                            }),
                                            "继续选择"
                                        ]
                                    })
                                ]
                            })
                        ]
                    })
                ]
            }),
            supportOpen && typeof document !== 'undefined' && /*#__PURE__*/ createPortal(/*#__PURE__*/ _jsx("div", {
                className: "support-modal-backdrop",
                role: "presentation",
                onMouseDown: (event)=>{
                    if (event.target === event.currentTarget) setSupportOpen(false);
                },
                children: /*#__PURE__*/ _jsxs("section", {
                    className: "support-modal",
                    role: "dialog",
                    "aria-modal": "true",
                    "aria-labelledby": "support-modal-title",
                    children: [
                        /*#__PURE__*/ _jsxs("header", {
                            className: "support-modal-head",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    className: "support-modal-title",
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            className: "support-modal-logo",
                                            children: "S"
                                        }),
                                        /*#__PURE__*/ _jsxs("div", {
                                            children: [
                                                /*#__PURE__*/ _jsx("small", {
                                                    children: "SANMAO.AI COMMUNITY"
                                                }),
                                                /*#__PURE__*/ _jsx("h2", {
                                                    id: "support-modal-title",
                                                    children: "交流与支持"
                                                })
                                            ]
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "support-modal-close",
                                    onClick: ()=>setSupportOpen(false),
                                    "aria-label": "关闭",
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close",
                                        size: 18
                                    })
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "support-tabs",
                            role: "tablist",
                            "aria-label": "交流与支持选项",
                            children: [
                                /*#__PURE__*/ _jsxs("button", {
                                    type: "button",
                                    role: "tab",
                                    "aria-selected": supportTab === 'community',
                                    className: supportTab === 'community' ? 'active' : '',
                                    onClick: ()=>setSupportTab('community'),
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            className: "support-tab-icon qq",
                                            children: "Q"
                                        }),
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "QQ 交流群"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsxs("button", {
                                    type: "button",
                                    role: "tab",
                                    "aria-selected": supportTab === 'reward',
                                    className: supportTab === 'reward' ? 'active' : '',
                                    onClick: ()=>setSupportTab('reward'),
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            className: "support-tab-icon reward",
                                            children: "♡"
                                        }),
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "赞赏开发"
                                        })
                                    ]
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("div", {
                            className: "support-modal-body",
                            children: supportTab === 'community' ? /*#__PURE__*/ _jsxs("div", {
                                className: "support-community-panel",
                                role: "tabpanel",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "support-community-hero",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                className: "support-community-orb",
                                                children: /*#__PURE__*/ _jsx("img", {
                                                    src: "/brand-mark.png",
                                                    alt: "SANMAO.AI"
                                                })
                                            }),
                                            /*#__PURE__*/ _jsxs("div", {
                                                children: [
                                                    /*#__PURE__*/ _jsx("span", {
                                                        children: "官方 QQ 交流群"
                                                    }),
                                                    /*#__PURE__*/ _jsx("strong", {
                                                        children: "1104660815"
                                                    }),
                                                    /*#__PURE__*/ _jsx("small", {
                                                        children: "交流创作技巧、反馈问题，也能第一时间获取更新动态"
                                                    })
                                                ]
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("button", {
                                        type: "button",
                                        className: "support-copy-button",
                                        onClick: async ()=>{
                                            try {
                                                await navigator.clipboard.writeText('1104660815');
                                                notify('QQ群号已复制：1104660815');
                                            } catch  {
                                                notify('QQ群：1104660815');
                                            }
                                        },
                                        children: [
                                            /*#__PURE__*/ _jsx(Icon, {
                                                name: "copy",
                                                size: 15
                                            }),
                                            "复制群号"
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "support-community-note",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "加入方式"
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                children: "打开 QQ → 搜索群号 → 申请加入"
                                            })
                                        ]
                                    })
                                ]
                            }) : /*#__PURE__*/ _jsxs("div", {
                                className: "support-reward-panel",
                                role: "tabpanel",
                                children: [
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "support-reward-copy",
                                        children: [
                                            /*#__PURE__*/ _jsx("span", {
                                                children: "自愿赞赏"
                                            }),
                                            /*#__PURE__*/ _jsx("h3", {
                                                children: "每一份支持，都会变成下一次更新"
                                            }),
                                            /*#__PURE__*/ _jsx("p", {
                                                children: "如果 SANMAO.AI 帮到了你，可以扫码请开发者喝杯咖啡。完全自愿，不影响任何功能。"
                                            })
                                        ]
                                    }),
                                    /*#__PURE__*/ _jsxs("div", {
                                        className: "support-qr-card",
                                        children: [
                                            /*#__PURE__*/ _jsx("img", {
                                                src: "/mm-reward-qrcode.png",
                                                alt: "SANMAO.AI 赞赏码"
                                            }),
                                            /*#__PURE__*/ _jsx("small", {
                                                children: "微信扫码赞赏"
                                            })
                                        ]
                                    })
                                ]
                            })
                        }),
                        /*#__PURE__*/ _jsxs("footer", {
                            className: "support-modal-foot",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: "感谢你的反馈、陪伴与支持"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    onClick: ()=>void copyAuthorWechat(),
                                    children: "联系作者 · 微信 wcsanmao"
                                })
                            ]
                        })
                    ]
                })
            }), document.body),
            sharePreview && typeof document !== 'undefined' && /*#__PURE__*/ createPortal(/*#__PURE__*/ _jsx("div", {
                className: "share-preview-backdrop",
                role: "presentation",
                onMouseDown: (event)=>{
                    if (event.target === event.currentTarget) setSharePreview(null);
                },
                children: /*#__PURE__*/ _jsxs("section", {
                    className: "share-preview-modal",
                    role: "dialog",
                    "aria-modal": "true",
                    "aria-labelledby": "share-preview-title",
                    children: [
                        /*#__PURE__*/ _jsxs("header", {
                            className: "share-preview-head",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("small", {
                                            children: "SANMAO.AI SHARE"
                                        }),
                                        /*#__PURE__*/ _jsx("h2", {
                                            id: "share-preview-title",
                                            children: "分享对话预览"
                                        }),
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "确认内容后下载 PNG，完整对话仅在本地生成"
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "share-preview-close",
                                    onClick: ()=>setSharePreview(null),
                                    "aria-label": "关闭分享预览",
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close",
                                        size: 18
                                    })
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("div", {
                            className: "share-preview-stage",
                            children: /*#__PURE__*/ _jsx("img", {
                                src: sharePreview.url,
                                alt: "SANMAO.AI 对话分享长图预览",
                                style: { aspectRatio: `${sharePreview.width} / ${sharePreview.height}` }
                            })
                        }),
                        /*#__PURE__*/ _jsxs("footer", {
                            className: "share-preview-foot",
                            children: [
                                /*#__PURE__*/ _jsx("span", {
                                    children: `${sharePreview.width} × ${sharePreview.height} PNG`
                                }),
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("button", {
                                            type: "button",
                                            className: "secondary-action",
                                            onClick: ()=>setSharePreview(null),
                                            children: "继续编辑"
                                        }),
                                        /*#__PURE__*/ _jsxs("button", {
                                            type: "button",
                                            className: "primary-action compact share-preview-download",
                                            onClick: downloadSharePreview,
                                            children: [
                                                /*#__PURE__*/ _jsx(Icon, {
                                                    name: "download",
                                                    size: 15
                                                }),
                                                "下载 PNG"
                                            ]
                                        })
                                    ]
                                })
                            ]
                        })
                    ]
                })
            }), document.body),
            confirmState && /*#__PURE__*/ _jsx("div", {
                className: "dialog-backdrop",
                onClick: ()=>setConfirmState(null),
                children: /*#__PURE__*/ _jsxs("div", {
                    className: "confirm-dialog",
                    onClick: (e)=>e.stopPropagation(),
                    children: [
                        /*#__PURE__*/ _jsx("div", {
                            className: `dialog-icon ${confirmState.danger ? 'danger' : ''}`,
                            children: /*#__PURE__*/ _jsx(Icon, {
                                name: confirmState.danger ? 'trash' : 'agent',
                                size: 22
                            })
                        }),
                        /*#__PURE__*/ _jsx("h2", {
                            children: confirmState.title
                        }),
                        /*#__PURE__*/ _jsx("p", {
                            children: confirmState.text
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            children: [
                                /*#__PURE__*/ _jsx("button", {
                                    className: "secondary-action",
                                    onClick: ()=>setConfirmState(null),
                                    children: "取消"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    className: confirmState.danger ? 'danger-action' : 'primary-action compact',
                                    onClick: async ()=>{
                                        const action = confirmState.action;
                                        setConfirmState(null);
                                        await action();
                                    },
                                    children: confirmState.confirmText || '确认'
                                })
                            ]
                        })
                    ]
                })
            }),
            outpaintEditor && /*#__PURE__*/ _jsx(OutpaintEditor, {
                item: outpaintEditor.item,
                model: selectedGenerateModel?.capabilities.includes('generate') ? selectedGenerateModel : defaultImageModel || availableGenerationModels[0] || null,
                onClose: ()=>setOutpaintEditor(null),
                onApply: publishOutpaintReference,
                onApplyLocal: saveLocalImageEdit,
                onNotify: notify
            }),
            messageReferencePreview && typeof document !== 'undefined' && /*#__PURE__*/ createPortal(/*#__PURE__*/ _jsx("div", {
                className: "reference-preview-backdrop",
                onClick: ()=>setMessageReferencePreview(null),
                children: /*#__PURE__*/ _jsxs("div", {
                    className: "reference-preview surface",
                    onClick: (event)=>event.stopPropagation(),
                    children: [
                        /*#__PURE__*/ _jsxs("div", {
                            className: "reference-preview-head",
                            children: [
                                /*#__PURE__*/ _jsxs("div", {
                                    children: [
                                        /*#__PURE__*/ _jsx("span", {
                                            children: "参考图预览"
                                        }),
                                        /*#__PURE__*/ _jsx("h3", {
                                            children: messageReferencePreview.name
                                        })
                                    ]
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "icon-button",
                                    onClick: ()=>setMessageReferencePreview(null),
                                    children: /*#__PURE__*/ _jsx(Icon, {
                                        name: "close"
                                    })
                                })
                            ]
                        }),
                        /*#__PURE__*/ _jsx("div", {
                            className: "reference-preview-stage",
                            children: /*#__PURE__*/ _jsx("img", {
                                src: messageReferencePreview.dataUrl,
                                alt: messageReferencePreview.name
                            })
                        }),
                        /*#__PURE__*/ _jsxs("div", {
                            className: "reference-preview-footer",
                            children: [
                                /*#__PURE__*/ _jsx("small", {
                                    children: "完整比例显示，不裁剪"
                                }),
                                /*#__PURE__*/ _jsx("button", {
                                    type: "button",
                                    className: "secondary-action compact",
                                    onClick: ()=>setMessageReferencePreview(null),
                                    children: "关闭"
                                })
                            ]
                        })
                    ]
                })
            }), document.body),
            angleOpenBusy && /*#__PURE__*/ _jsxs("div", {
                className: "angle-open-loading",
                role: "status",
                "aria-live": "polite",
                children: [
                    /*#__PURE__*/ _jsx("span", {
                        className: "mini-loader"
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            /*#__PURE__*/ _jsx("strong", {
                                children: "正在打开角度控制台"
                            }),
                            /*#__PURE__*/ _jsx("small", {
                                children: "正在准备参考图，请稍候…"
                            })
                        ]
                    })
                ]
            }),
            angleResultToast && /*#__PURE__*/ _jsxs("div", {
                className: "angle-result-toast",
                role: "status",
                "aria-live": "polite",
                children: [
                    /*#__PURE__*/ _jsx("span", {
                        className: "angle-result-toast-mark",
                        children: "✓"
                    }),
                    /*#__PURE__*/ _jsxs("div", {
                        children: [
                            /*#__PURE__*/ _jsx("strong", {
                                children: "角度结果已生成"
                            }),
                            /*#__PURE__*/ _jsx("small", {
                                children: "你的图已经生好了，可继续调整或查看结果。"
                            })
                        ]
                    }),
                    /*#__PURE__*/ _jsx("button", {
                        type: "button",
                        onClick: openAngleResultFromToast,
                        children: "查看结果"
                    }),
                    /*#__PURE__*/ _jsx("button", {
                        type: "button",
                        className: "angle-result-toast-close",
                        onClick: ()=>setAngleResultToast(null),
                        "aria-label": "关闭提醒",
                        children: "\xd7"
                    })
                ]
            }),
            toast && /*#__PURE__*/ _jsx("div", {
                className: "toast",
                children: toast
            })
        ]
    });
}
function AdminLogin({ password, setPassword, busy, onSubmit }) {
    return /*#__PURE__*/ _jsx("section", {
        className: "admin-login-page",
        children: /*#__PURE__*/ _jsxs("form", {
            className: "admin-login surface",
            onSubmit: onSubmit,
            children: [
                /*#__PURE__*/ _jsx("div", {
                    className: "hero-orb small",
                    children: /*#__PURE__*/ _jsx(Icon, {
                        name: "model",
                        size: 21
                    })
                }),
                /*#__PURE__*/ _jsx("h1", {
                    children: "管理员登录"
                }),
                /*#__PURE__*/ _jsx("p", {
                    children: "接口服务和模型选择属于平台管理配置。普通使用者不需要进入这里。"
                }),
                /*#__PURE__*/ _jsxs("label", {
                    children: [
                        /*#__PURE__*/ _jsx("span", {
                            children: "管理员密码"
                        }),
                        /*#__PURE__*/ _jsx("input", {
                            type: "password",
                            value: password,
                            onChange: (e)=>setPassword(e.target.value),
                            autoFocus: true,
                            placeholder: "输入管理员密码"
                        })
                    ]
                }),
                /*#__PURE__*/ _jsx("button", {
                    className: "primary-action",
                    disabled: busy || !password.trim(),
                    children: busy ? '验证中…' : '进入管理'
                })
            ]
        })
    });
}
