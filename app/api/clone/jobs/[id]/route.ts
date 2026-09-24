import { isTrustedAppRequest } from '@/lib/auth';
import { cleanupCloneJobDirectory, renderBlueprintVariant, renderBlueprintVariants, rerenderCloneJob, runCloneJob } from '@/lib/clone/pipeline';
import { buildBlueprintVariantPlans, normalizeCloneOptions } from '@/lib/clone/plan';
import { findCloneJob, removeCloneJob, updateCloneJob } from '@/lib/clone/store';
import type { CloneBlueprintVariantOverride, CloneBlueprintVariantSpec, CloneShot } from '@/lib/clone/types';
import { normalizeVideoEditorState } from '@/lib/canvas/video-editor';
import type { CanvasVideoEditorState } from '@/lib/canvas/types';

function normalizeVariantSpec(value: unknown, fallbackId: string, fallbackName: string): CloneBlueprintVariantSpec | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const rawOverrides = Array.isArray(source.overrides) ? source.overrides : [];
  const overrides = rawOverrides.filter((item) => item && typeof item === 'object').slice(0, 64).map((item): CloneBlueprintVariantOverride => {
    const raw = item as Record<string, unknown>;
    return {
      ...(typeof raw.componentId === 'string' ? { componentId: raw.componentId.trim().slice(0, 80) } : {}),
      ...(Array.isArray(raw.shotIndexes) ? { shotIndexes: raw.shotIndexes.filter((index): index is number => Number.isInteger(index)).slice(0, 64) } : {}),
      ...(Array.isArray(raw.assetIds) ? { assetIds: raw.assetIds.filter((assetId): assetId is string => typeof assetId === 'string').map((assetId) => assetId.trim()).filter(Boolean).slice(0, 16) } : {}),
      ...(typeof raw.text === 'string' ? { text: raw.text.slice(0, 2000) } : {}),
      ...(typeof raw.graphicsText === 'string' ? { graphicsText: raw.graphicsText.slice(0, 2000) } : {}),
      ...(typeof raw.visual === 'string' ? { visual: raw.visual.slice(0, 2000) } : {}),
      ...(typeof raw.line === 'string' ? { line: raw.line.slice(0, 2000) } : {}),
      ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt.slice(0, 2000) } : {}),
      ...(raw.layout && typeof raw.layout === 'object' ? { layout: raw.layout as CloneBlueprintVariantOverride['layout'] } : {}),
      ...(typeof raw.motionPath === 'string' ? { motionPath: raw.motionPath as CloneBlueprintVariantOverride['motionPath'] } : {}),
      ...(typeof raw.graphicsStyle === 'string' ? { graphicsStyle: raw.graphicsStyle.slice(0, 180) } : {}),
      ...(typeof raw.preserveReferenceFrame === 'boolean' ? { preserveReferenceFrame: raw.preserveReferenceFrame } : {}),
      ...(typeof raw.allowReferenceOverlays === 'boolean' ? { allowReferenceOverlays: raw.allowReferenceOverlays } : {}),
      ...(typeof raw.regenerate === 'boolean' ? { regenerate: raw.regenerate } : {}),
    };
  });
  return {
    id: String(source.id || fallbackId).trim().slice(0, 80),
    name: String(source.name || fallbackName).trim().slice(0, 120),
    ...(source.description ? { description: String(source.description).trim().slice(0, 400) } : {}),
    overrides,
  };
}

function normalizeShotStrategy(
  requested: CloneShot['strategy'] | undefined,
  job: Awaited<ReturnType<typeof findCloneJob>>,
  assetIds: string[],
) {
  if (!job) return 'text' as const;
  const hasImageReference = assetIds.some((id) => job.assets.some((asset) => asset.kind === 'image' && (asset.nodeId || asset.url) === id));
  if (requested === 'reference') return job.capabilities.video && job.capabilities.referenceImages && hasImageReference ? 'reference' : job.capabilities.video ? 'text' : 'static';
  if (requested === 'keyframe') return job.capabilities.video && job.capabilities.firstFrame ? 'keyframe' : job.capabilities.video ? 'text' : 'static';
  if (requested === 'text') return job.capabilities.video ? 'text' : 'static';
  return 'static' as const;
}

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  return Response.json({ ok: true, job });
}

/**
 * 两个动作都是「就地改这条任务」，所以挂在同一个路由上：
 * · resume  —— 失败/中断后接着跑：已生成的镜头、配音会跳过，不重复计费。
 * · applied —— 成片已经放进画布，重开弹窗不再重复提示。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body && typeof body === 'object' ? String((body as { action?: unknown }).action || '') : '';
  const job = await findCloneJob(id);
  if (!job) return Response.json({ error: '任务不存在。' }, { status: 404 });
  if (action === 'rerender') {
    try {
      const rawShots = body && typeof body === 'object' ? (body as { shots?: unknown }).shots : undefined;
      const shots = rawShots === undefined ? undefined : Array.isArray(rawShots) && rawShots.length === job.shots.length && rawShots.every((item) => item && typeof item === 'object')
        ? rawShots.map((item, index) => ({ ...job.shots[index], ...(item as Partial<CloneShot>) }))
        : null;
      if (shots === null) return Response.json({ error: '重出镜头参数无效' }, { status: 400 });
      const rawTimeline = body && typeof body === 'object' ? (body as { timeline?: unknown }).timeline : undefined;
      const timeline = rawTimeline && typeof rawTimeline === 'object'
        ? normalizeVideoEditorState(rawTimeline as CanvasVideoEditorState)
        : undefined;
      const updated = await rerenderCloneJob(id, shots, timeline);
      return Response.json({ ok: true, job: updated }, { status: 202 });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '重新合成失败' }, { status: 400 });
    }
  }
  if (action === 'variant-plan') {
    if (!job.blueprint) return Response.json({ error: '这条任务还没有可复用的 Blueprint' }, { status: 400 });
    const rawSpecs = body && typeof body === 'object' ? (body as { variants?: unknown }).variants : undefined;
    if (!Array.isArray(rawSpecs) || !rawSpecs.length || rawSpecs.length > 12) {
      return Response.json({ error: '请提供 1 到 12 个变体方案' }, { status: 400 });
    }
    const specs: CloneBlueprintVariantSpec[] = rawSpecs.flatMap((value, index) => {
      if (!value || typeof value !== 'object') return [];
      const source = value as Record<string, unknown>;
      const overrides = Array.isArray(source.overrides)
        ? source.overrides.filter((item) => item && typeof item === 'object').slice(0, 64).map((item): CloneBlueprintVariantOverride => {
          const raw = item as Record<string, unknown>;
          return {
            ...(typeof raw.componentId === 'string' ? { componentId: raw.componentId.trim().slice(0, 80) } : {}),
            ...(Array.isArray(raw.shotIndexes) ? { shotIndexes: raw.shotIndexes.filter((index): index is number => Number.isInteger(index)).slice(0, 64) } : {}),
            ...(Array.isArray(raw.assetIds) ? { assetIds: raw.assetIds.filter((assetId): assetId is string => typeof assetId === 'string').map((assetId) => assetId.trim()).filter(Boolean).slice(0, 16) } : {}),
            ...(typeof raw.text === 'string' ? { text: raw.text.slice(0, 2000) } : {}),
            ...(typeof raw.graphicsText === 'string' ? { graphicsText: raw.graphicsText.slice(0, 2000) } : {}),
            ...(typeof raw.visual === 'string' ? { visual: raw.visual.slice(0, 2000) } : {}),
            ...(typeof raw.line === 'string' ? { line: raw.line.slice(0, 2000) } : {}),
            ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt.slice(0, 2000) } : {}),
            ...(raw.layout && typeof raw.layout === 'object' ? { layout: raw.layout as CloneBlueprintVariantOverride['layout'] } : {}),
            ...(typeof raw.motionPath === 'string' ? { motionPath: raw.motionPath as CloneBlueprintVariantOverride['motionPath'] } : {}),
            ...(typeof raw.graphicsStyle === 'string' ? { graphicsStyle: raw.graphicsStyle.slice(0, 180) } : {}),
            ...(typeof raw.preserveReferenceFrame === 'boolean' ? { preserveReferenceFrame: raw.preserveReferenceFrame } : {}),
            ...(typeof raw.allowReferenceOverlays === 'boolean' ? { allowReferenceOverlays: raw.allowReferenceOverlays } : {}),
            ...(typeof raw.regenerate === 'boolean' ? { regenerate: raw.regenerate } : {}),
          };
        })
        : [];
      return [{
        id: String(source.id || `variant-${index + 1}`).trim().slice(0, 80),
        name: String(source.name || `变体 ${index + 1}`).trim().slice(0, 120),
        ...(source.description ? { description: String(source.description).trim().slice(0, 400) } : {}),
        overrides,
      }];
    });
    if (!specs.length) return Response.json({ error: '没有有效的变体方案' }, { status: 400 });
    const plans = buildBlueprintVariantPlans(job.blueprint, specs, normalizeCloneOptions(job.options), job.referenceAnalysis?.transcriptData);
    const updated = await updateCloneJob(id, {
      blueprint: { ...job.blueprint, variants: specs, updatedAt: new Date().toISOString() },
    });
    return Response.json({ ok: true, plans, variants: specs, job: updated });
  }
  if (action === 'variant-render-batch') {
    if (!job.blueprint) return Response.json({ error: 'Blueprint missing' }, { status: 400 });
    const rawVariants = body && typeof body === 'object' ? (body as { variants?: unknown }).variants : undefined;
    if (!Array.isArray(rawVariants) || !rawVariants.length || rawVariants.length > 12) {
      return Response.json({ error: 'Provide 1 to 12 variants' }, { status: 400 });
    }
    const variants = rawVariants.flatMap((value, index) => {
      const spec = normalizeVariantSpec(value, `variant-${Date.now()}-${index + 1}`, `Variant ${index + 1}`);
      return spec ? [spec] : [];
    });
    if (!variants.length) return Response.json({ error: 'No valid variants' }, { status: 400 });
    try {
      const rendered = await renderBlueprintVariants(id, variants);
      return Response.json({ ok: true, results: rendered, plans: rendered.map((item) => item.plan), job: rendered.at(-1)?.job || job });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'Batch variant rendering failed' }, { status: 400 });
    }
  }
  if (action === 'variant-render') {
    if (!job.blueprint) return Response.json({ error: '这条任务还没有可复用的 Blueprint' }, { status: 400 });
    const rawVariant = body && typeof body === 'object' ? (body as { variant?: unknown }).variant : undefined;
    if (!rawVariant || typeof rawVariant !== 'object') return Response.json({ error: '缺少变体方案' }, { status: 400 });
    try {
      const source = rawVariant as Record<string, unknown>;
      const rawOverrides = Array.isArray(source.overrides) ? source.overrides : [];
      const variant: CloneBlueprintVariantSpec = {
        id: String(source.id || `variant-${Date.now()}`).trim().slice(0, 80),
        name: String(source.name || '本地变体').trim().slice(0, 120),
        ...(source.description ? { description: String(source.description).trim().slice(0, 400) } : {}),
        overrides: rawOverrides.filter((item) => item && typeof item === 'object').slice(0, 64).map((item) => {
          const raw = item as Record<string, unknown>;
          return {
            ...(typeof raw.componentId === 'string' ? { componentId: raw.componentId.trim().slice(0, 80) } : {}),
            ...(Array.isArray(raw.shotIndexes) ? { shotIndexes: raw.shotIndexes.filter((index): index is number => Number.isInteger(index)).slice(0, 64) } : {}),
            ...(Array.isArray(raw.assetIds) ? { assetIds: raw.assetIds.filter((assetId): assetId is string => typeof assetId === 'string').map((assetId) => assetId.trim()).filter(Boolean).slice(0, 16) } : {}),
            ...(typeof raw.text === 'string' ? { text: raw.text.slice(0, 2000) } : {}),
            ...(typeof raw.graphicsText === 'string' ? { graphicsText: raw.graphicsText.slice(0, 2000) } : {}),
            ...(typeof raw.visual === 'string' ? { visual: raw.visual.slice(0, 2000) } : {}),
            ...(typeof raw.line === 'string' ? { line: raw.line.slice(0, 2000) } : {}),
            ...(typeof raw.prompt === 'string' ? { prompt: raw.prompt.slice(0, 2000) } : {}),
            ...(raw.layout && typeof raw.layout === 'object' ? { layout: raw.layout as CloneBlueprintVariantOverride['layout'] } : {}),
            ...(typeof raw.motionPath === 'string' ? { motionPath: raw.motionPath as CloneBlueprintVariantOverride['motionPath'] } : {}),
            ...(typeof raw.graphicsStyle === 'string' ? { graphicsStyle: raw.graphicsStyle.slice(0, 180) } : {}),
            ...(typeof raw.preserveReferenceFrame === 'boolean' ? { preserveReferenceFrame: raw.preserveReferenceFrame } : {}),
            ...(typeof raw.allowReferenceOverlays === 'boolean' ? { allowReferenceOverlays: raw.allowReferenceOverlays } : {}),
            ...(typeof raw.regenerate === 'boolean' ? { regenerate: raw.regenerate } : {}),
          };
        }),
      };
      const rendered = await renderBlueprintVariant(id, variant);
      return Response.json({ ok: true, ...rendered });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : '变体合成失败' }, { status: 400 });
    }
  }
  if (action === 'applied') {
    return Response.json({ ok: true, job: await updateCloneJob(id, { appliedAt: job.appliedAt || new Date().toISOString() }) });
  }
  if (action === 'confirm') {
    if (job.stage !== 'planned') return Response.json({ error: '镜头计划尚未生成' }, { status: 400 });
    const rawShots = body && typeof body === 'object' ? (body as { shots?: unknown }).shots : undefined;
    let shots = job.shots;
    if (rawShots !== undefined) {
      if (!Array.isArray(rawShots) || rawShots.length !== job.shots.length) return Response.json({ error: '镜头计划数量不匹配' }, { status: 400 });
      const allowed = new Set(['reference', 'keyframe', 'text', 'static']);
      const validAssetIds = new Set(job.assets.map((asset) => asset.nodeId || asset.url));
      const strategyWarnings: string[] = [];
      shots = rawShots.map((value, index) => {
        const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
        const original = job.shots[index];
        const requestedStrategy = typeof source.strategy === 'string' && allowed.has(source.strategy) ? source.strategy as CloneShot['strategy'] : original.strategy;
        const assetIds = Array.isArray(source.assetIds)
          ? [...new Set(source.assetIds.filter((item): item is string => typeof item === 'string' && validAssetIds.has(item)))].slice(0, 16)
          : original.assetIds;
        const strategy = normalizeShotStrategy(requestedStrategy, job, assetIds || []);
        if (requestedStrategy && requestedStrategy !== strategy) strategyWarnings.push(`镜头 ${index + 1} 的「${requestedStrategy}」不兼容当前视频模型或素材，已改为「${strategy}」。`);
        const speechMode = source.speechMode === 'talking' || source.speechMode === 'silent' || source.speechMode === 'narration' ? source.speechMode : original.speechMode;
        return {
          ...original,
          assetIds,
          strategy,
          speechMode,
          preserveIdentity: Boolean(source.preserveIdentity ?? original.preserveIdentity),
          preserveProduct: Boolean(source.preserveProduct ?? original.preserveProduct),
          preserveReferenceFrame: Boolean(source.preserveReferenceFrame ?? original.preserveReferenceFrame),
        };
      });
      if (strategyWarnings.length) await updateCloneJob(id, { warnings: [...new Set([...job.warnings, ...strategyWarnings])] });
    }
    const latest = await findCloneJob(id) || job;
    const updated = await updateCloneJob(id, { planConfirmed: true, shots, blueprint: latest.blueprint ? { ...latest.blueprint, shots, updatedAt: new Date().toISOString() } : undefined, stage: 'queued', message: '已确认镜头计划，等待生成' });
    void runCloneJob(id).catch(() => undefined);
    return Response.json({ ok: true, job: updated }, { status: 202 });
  }
  if (action !== 'resume') return Response.json({ error: '不支持的操作。' }, { status: 400 });
  if (job.stage === 'done' || job.stage === 'cancelled') {
    return Response.json({ error: '这条任务已经结束了，请重新设置参数再开始。' }, { status: 400 });
  }
  // 续跑是后台任务，立刻把任务交回前端轮询。
  void runCloneJob(id).catch(() => undefined);
  return Response.json({ ok: true, job: await findCloneJob(id) }, { status: 202 });
}

/**
 * 删除一条任务记录。
 * 任务还在跑时先标记取消：管线在下一个检查点会退出，不会留下一条没人认领的后台任务继续生图、生视频。
 * 只删任务记录与任务目录；已经落到素材库的图片 / 视频 / 配音不删——它们可能已经放进画布了。
 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isTrustedAppRequest(request)) return Response.json({ error: '需要管理员登录。' }, { status: 401 });
  const { id } = await context.params;
  const job = await findCloneJob(id);
  if (!job) return Response.json({ ok: true, deleted: false });
  const wasRunning = job.stage !== 'done' && job.stage !== 'failed' && job.stage !== 'cancelled';
  if (wasRunning) await updateCloneJob(id, { cancelRequested: true });
  const removed = await removeCloneJob(id);
  await cleanupCloneJobDirectory(id);
  return Response.json({ ok: true, deleted: Boolean(removed), cancelled: wasRunning });
}
