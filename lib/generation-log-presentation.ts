import type { GenerationLog } from "@/lib/generation-log";
import { IMAGE_RATIOS } from "@/lib/creation/settings";

export const ratios = [...IMAGE_RATIOS] as string[];
export type GenerationLogPresentationKind = "image" | "video" | "audio" | "llm";
export type ImageSpec = { width?: number; height?: number; ratio?: string; resolution?: string };
export type EditorLike = { ratio: string; item: { outputSize?: string | null } };
export const ratioDescriptions = {
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
export const sizeTiers = [
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

export function generationLogSourceLabel(log: GenerationLog): string {
    if (log.taskKind === 'llm' || log.mode === 'llm') return log.source === 'canvas' ? '画布 LLM' : '助手 LLM';
    if (log.source === 'canvas') return '画布生成';
    if (log.mode === 'video') return log.operation === 'edit' ? '视频编辑' : log.operation === 'extend' ? '视频扩展' : '视频生成';
    if (log.mode === 'audio' || log.mediaKind === 'audio') return '音频生成';
    if (log.source === 'agent') return '助手生成';
    return log.mode === 'edit' ? '图片修改' : log.mode === 'upscale' ? '图片超分' : '工作台生成';
}

export function gallerySourceLabel(source: unknown): string {
    if (source === 'canvas') return '画布生成';
    if (source === 'agent') return '助手生成';
    if (source === 'edit') return '图片修改';
    if (source === 'upscale') return '高清放大';
    return '直接生成';
}

export function generationLogTitle(log: GenerationLog): string {
    const prompt = String(log.prompt || '').trim();
    if (!prompt) return generationLogIsLlm(log) ? '未填写对话内容' : '未填写提示词';
    const contextIndexes = [prompt.indexOf('[画布上下文]'), prompt.indexOf('【画布上下文】')].filter((index)=>index >= 0);
    const contextIndex = contextIndexes.length ? Math.min(...contextIndexes) : -1;
    const userPrompt = (contextIndex >= 0 ? prompt.slice(0, contextIndex) : prompt)
        .replace(/\s+/g, ' ')
        .replace(/^#{1,6}\s*/, '')
        .replace(/\*\*|__|`/g, '')
        .trim();
    return userPrompt || (generationLogIsLlm(log) ? '画布上下文任务' : '未填写提示词');
}
export function generationMediaKind(log: GenerationLog): GenerationLogPresentationKind {
    if (log.taskKind === 'llm' || log.mode === 'llm') return 'llm';
    if (log.mediaKind === 'audio' || log.mode === 'audio') return 'audio';
    if (log.mediaKind === 'video' || log.mode === 'video') return 'video';
    return 'image';
}
export function generationLogIsLlm(log: GenerationLog): boolean {
    return generationMediaKind(log) === 'llm';
}
export function generationLlmCallLabel(log: GenerationLog): string {
    const calls = typeof log.llmCallCount === 'number' ? log.llmCallCount : 0;
    const chars = typeof log.responseChars === 'number' ? log.responseChars : 0;
    return `${calls} 次模型调用 · ${chars} 字响应`;
}
export function generationMediaLabel(kind: GenerationLogPresentationKind): string {
    return kind === 'llm' ? 'LLM' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片';
}
export function ratioFromDimensions(width: number, height: number): string {
    if (!width || !height) return '未知';
    const actual = width / height;
    const candidates = ratios.filter((item)=>item.includes(':')).map((item)=>({
            item,
            value: Number(item.split(':')[0]) / Number(item.split(':')[1])
        }));
    return candidates.reduce((best, candidate)=>Math.abs(candidate.value - actual) < Math.abs(best.value - actual) ? candidate : best).item;
}
export function exactRatioFromDimensions(width: number, height: number): string {
    if (!width || !height) return '自动';
    const divisor = gcd(Math.round(width), Math.round(height));
    return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`;
}
export function ratioValue(ratio: string, customWidth = 1, customHeight = 1): number {
    if (ratio === '自定义') return customWidth > 0 && customHeight > 0 ? customWidth / customHeight : 1;
    const [rawWidth, rawHeight] = ratio.split(':').map(Number);
    return rawWidth > 0 && rawHeight > 0 ? rawWidth / rawHeight : 1;
}
export function ratioLabel(ratio: string, customWidth: number, customHeight: number): string {
    return ratio === '自定义' && customWidth > 0 && customHeight > 0 ? `${customWidth}:${customHeight}` : ratio;
}
export function resolutionFromDimensions(width: number, height: number): string {
    const longEdge = Math.max(width, height);
    return longEdge <= 1536 ? '1K' : longEdge <= 2304 ? '2K' : longEdge <= 3072 ? '3K' : '4K';
}
export function logResolutionLabel(log: GenerationLog, spec?: ImageSpec): string {
    return log.resolution || log.outputSize?.match(/^(1K|2K|3K|4K)/i)?.[1]?.toUpperCase() || spec?.resolution || '未记录';
}
export function logOutputSizeLabel(log: GenerationLog, spec?: ImageSpec): string {
    return log.outputSize || (spec ? `${spec.width}×${spec.height}` : '尺寸未记录');
}
export function logAspectRatioLabel(log: GenerationLog, spec?: ImageSpec): string {
    return log.aspectRatio || spec?.ratio || '比例未记录';
}
export function logDurationTone(durationMs?: number): string {
    if (!durationMs) return 'unknown';
    return durationMs < 10000 ? 'fast' : durationMs < 30000 ? 'normal' : 'slow';
}
export function formatTime(ts: string | number | Date): string {
    return new Date(ts).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}
export function chatHistoryGroupLabel(ts: string | number | Date): string {
    const date = new Date(ts);
    const today = new Date();
    const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const dayDifference = Math.round((todayDay.getTime() - dateDay.getTime()) / 86400000);
    if (dayDifference <= 0) return '今天';
    if (dayDifference === 1) return '昨天';
    return '更早';
}

export function nearest16(value: number): number {
    return Math.max(256, Math.round(value / 16) * 16);
}
export function gcd(a: number, b: number): number {
    return b ? gcd(b, a % b) : a;
}
export function presetDimensions(ratio: string, tier: string, customRatioWidth = 1, customRatioHeight = 1): { width: number; height: number } {
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
export function outputDimensions(outputSize?: string | null): { width: number; height: number } | null {
    const match = outputSize?.match(/(\d+)\s*[x×]\s*(\d+)/i);
    return match ? {
        width: Number(match[1]),
        height: Number(match[2])
    } : null;
}
export function sizeTierFromDimensions(width: number, height: number): string {
    const longEdge = Math.max(width, height);
    return longEdge > 3072 ? '4k' : longEdge > 2304 ? '3k' : longEdge > 1536 ? '2k' : '1k';
}
export function editorRatio(editor: EditorLike): string {
    if (editor.ratio !== '自动') return editor.ratio;
    const dimensions = outputDimensions(editor.item.outputSize);
    return dimensions ? exactRatioFromDimensions(dimensions.width, dimensions.height) : '1:1';
}
