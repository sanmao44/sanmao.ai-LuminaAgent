import type { ChatMessage } from '../contracts/chat';
import type { ToolCall, RuntimeImage, ToolRuntimeState } from './capability-state';
import type { RuntimeObserver } from '../contracts/observability';
import { invokeMediaModelCandidates } from '../model-runtime/media';

export type ImageCapabilityPorts = {
  observer?: RuntimeObserver;
  latest?: { content?: unknown };
  requestController: AbortController;
  imageToolsAllowed: boolean;
  batchPlanContent?: string;
  isBareImageExecution: (input: string) => boolean;
  extractBatchPrompts: (content: string) => string[];
  fallbackImagePrompt: string;
  requestedImageCapability?: 'generate' | 'edit';
  latestRefs: readonly Record<string, unknown>[];
  trackedChatCompletion: (provider: unknown, model: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<{ choices?: Array<{ message?: { content?: unknown } }> } | null>;
  agentRuntime: { provider: unknown; model: { rawId: string } };
  requestedAgentImageModelId?: string;
  imageModels: readonly { id?: string; capabilities?: readonly string[] }[];
  getRuntimeImageGenerationModel: (id?: string | null) => Promise<{ provider: unknown; model: { id: string; rawId: string; displayName: string } } | null>;
  getRuntimeImageModelForCapability: (id: string | null | undefined, capability: string) => Promise<{ provider: unknown; model: { id: string; rawId: string; displayName: string } } | null>;
  appendGenerationLog: (log: Record<string, unknown>) => Promise<void>;
  sourceForLog: string;
  taskContext: Record<string, unknown>;
  startGenerationLog: (log: Record<string, unknown>) => Promise<string>;
  referenceRecords: readonly Record<string, unknown>[];
  getRuntimeImageModelCandidates: (id: string, capability: string) => readonly RuntimeImage[];
  editImage: (provider: unknown, model: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<RuntimeImage[]>;
  generateImage: (provider: unknown, model: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<RuntimeImage[]>;
  persistGenerationResult: (options: Record<string, unknown>) => Promise<{ images: RuntimeImage[] }>;
  imageDownloadAuth: (provider: unknown) => unknown;
  finishGenerationLog: (id: string, patch: Record<string, unknown>) => Promise<void>;
  latestInstruction?: string;
  agentRunId?: string;
  executionPublicState: { settings: { imageStoragePath?: string } };
};

export type ImageCapabilityInput = {
  state: ToolRuntimeState & Record<string, unknown>;
  call: ToolCall;
  args: Record<string, unknown>;
  results: ChatMessage[];
  ports: ImageCapabilityPorts;
};

export function normalizeImagePromptBatch(input: { args: Record<string, unknown>; latestInstruction: string; batchPlanContent?: string; fallbackImagePrompt: string; isBareImageExecution: (value: string) => boolean; extractBatchPrompts: (value: string) => string[] }) {
  const { args, latestInstruction, batchPlanContent, fallbackImagePrompt, isBareImageExecution, extractBatchPrompts } = input;
  const requestedPrompts = Array.isArray(args.prompts) ? args.prompts.map((value: unknown) => String(value || '').trim()).filter(Boolean).slice(0, 20) : [];
  const deterministicBatchPrompts = batchPlanContent && (isBareImageExecution(latestInstruction) || /(?:套图|详情图|批量生图|批量出图|一套图|一组图|系列图|多张图|组图)/i.test(latestInstruction)) ? extractBatchPrompts(batchPlanContent) : [];
  const effectiveRequestedPrompts = deterministicBatchPrompts.length ? deterministicBatchPrompts : requestedPrompts;
  const prompts = effectiveRequestedPrompts.length ? effectiveRequestedPrompts : [!args.prompt || isBareImageExecution(String(args.prompt)) ? fallbackImagePrompt : String(args.prompt)];
  return { requestedPrompts, effectiveRequestedPrompts, prompts, prompt: prompts[0], count: effectiveRequestedPrompts.length ? 1 : Math.max(1, Math.min(8, Number(args.count || 1))) };
}

export async function executeImageCapability(input: ImageCapabilityInput): Promise<{ results: ChatMessage[] }> {
  const { state, call, args, results } = input;
  if (!input.ports?.imageToolsAllowed) return { results };
  const {
    observer, latest, requestController, imageToolsAllowed, batchPlanContent,
    isBareImageExecution, extractBatchPrompts, fallbackImagePrompt, requestedImageCapability, latestRefs,
    trackedChatCompletion, agentRuntime, requestedAgentImageModelId, imageModels, getRuntimeImageGenerationModel,
    getRuntimeImageModelForCapability, appendGenerationLog, sourceForLog, taskContext, startGenerationLog,
    referenceRecords, getRuntimeImageModelCandidates, editImage, generateImage,
    persistGenerationResult, imageDownloadAuth, finishGenerationLog, latestInstruction, agentRunId, executionPublicState,
  } = input.ports;
  let { generated, preparedCaption, batchItems, generations } = state;
      const startedAt = Date.now();
      const promptBatch = normalizeImagePromptBatch({ args, latestInstruction: latestInstruction || '', batchPlanContent, fallbackImagePrompt, isBareImageExecution, extractBatchPrompts });
      const { effectiveRequestedPrompts, prompts, prompt, count } = promptBatch;
      const aspectRatio = String(args.aspectRatio || fallbackImagePrompt.match(/\b(?:1:1|2:3|3:2|3:4|4:3|9:16|16:9|21:9)\b/g)?.at(-1) || '自动');
      // References are not enough to turn a new-image batch into an edit. The
      // server-side intent decision is authoritative over the model's tool name.
      const mode = requestedImageCapability;
      if (latestRefs.some((reference: { kind?: string }) => reference.kind === 'video')) {
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: '图片模型不能接收视频引用；请改用视频生成输入或移除视频引用。' }) });
        return { results };
      }
      if (!preparedCaption) {
          preparedCaption = trackedChatCompletion(agentRuntime.provider, agentRuntime.model.rawId, {
          messages: [
            { role: 'system', content: '只根据用户意图和已确认的图片提示词，写一段简短中文创作说明。末尾必须添加“下一版可尝试方向”小标题，并使用 1.、2.、3. 的有序列表列出 2—3 个可直接用于基于当前图片继续修改的方向，每项一句话。不要假装逐像素看到了图片，不要重复已完成生成。使用自然、精炼的 Markdown。' },
            { role: 'user', content: `用户意图：${String(latest?.content || '').slice(0, 1200)}\n已确认的图片提示词：${prompt.slice(0, 4000)}` },
          ],
          tool_choice: 'none',
        }, requestController.signal).then((result: { choices?: Array<{ message?: { content?: unknown } }> } | null) => String(result?.choices?.[0]?.message?.content || '').trim()).catch((error: unknown) => {
          if (requestController.signal.aborted) throw requestController.signal.reason || error;
          return '本版已按你确认的创作方向生成。下一版可以继续调整构图、光线或风格细节。';
        });
      }
      // Model selection is controlled by the client/system settings. Never let
      // the language model override the configured default through tool args.
      const requestedImageModelId = requestedAgentImageModelId;
      const requiredImageCapability = mode === 'edit' ? 'edit' : 'generate';
      const explicitlyRequestedImageModel = requestedImageModelId !== 'auto';
      if (explicitlyRequestedImageModel && !imageModels.some((model: { id?: string; capabilities?: readonly string[] }) => model.id === requestedImageModelId
        && (model.capabilities || []).includes(requiredImageCapability))) {
        const error = '本轮选择的生图模型不支持当前任务，请重新选择或改用自动选择。';
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error }) });
        return { results };
      }
      // The server-side intent decides the capability. Do not let a model
      // emit an edit tool name and bypass the configured generation model.
      let imageRuntime = mode === 'generate'
        ? await getRuntimeImageGenerationModel(requestedImageModelId)
        : await getRuntimeImageModelForCapability(requestedImageModelId, 'edit');
      if (explicitlyRequestedImageModel && (!imageRuntime || imageRuntime.model.id !== requestedImageModelId)) {
        const error = '本轮选择的生图模型当前不可用，请重新选择或改用自动选择。';
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error }) });
        return { results };
      }
      if (!imageRuntime) {
        const diagnosis = mode === 'edit'
          ? '没有可用的改图模型：请在模型库启用并发布至少一个支持 edit 的图片模型；文生图模型不能代替改图模型。'
          : '没有可用的生图模型：请在模型库启用并发布至少一个支持 generate 的图片模型；对话模型不能代替生图模型。';
        await appendGenerationLog({ status: 'error', mode, source: sourceForLog, prompt, aspectRatio, count, durationMs: Date.now() - startedAt, error: '没有可用的图片模型', ...taskContext }).catch(() => undefined);
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: diagnosis, diagnosis }) });
        return { results };
      }
      let selectedImageRuntime = imageRuntime;
      const mediaLogId = await startGenerationLog({
        mode,
        taskKind: 'media',
        source: sourceForLog,
        prompt,
        aspectRatio,
        modelId: selectedImageRuntime.model.id,
        modelName: selectedImageRuntime.model.displayName,
        providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''),
        count,
        ...taskContext,
      }).catch(() => null);
      try {
        const imageReferences = latestRefs.filter((reference: { kind?: string; url?: string }) => reference.kind === 'image' && reference.url).map((reference: { kind?: string; url?: string }) => reference.url!);
        if (mode === 'edit' && !imageReferences.length) throw new Error('请先提供图片参考');
        const images: RuntimeImage[] = [];
        const batchId = effectiveRequestedPrompts.length > 1 ? `agent-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` : undefined;
        const initialRuntime = imageRuntime;
        const runPrompt = async (itemPrompt: string, promptIndex: number) => {
          let itemRuntime = initialRuntime;
          const providerOperationId = `${agentRunId || 'agent-request'}-image-${promptIndex + 1}`;
          const providerStartedAt = Date.now();
          void observer?.emit({ operationId: providerOperationId, kind: 'provider', phase: 'started', at: providerStartedAt, identity: String((initialRuntime.provider as { name?: unknown }).name || 'image') });
          try {
            const itemImages = await invokeMediaModelCandidates(
              initialRuntime,
              async () => explicitlyRequestedImageModel
                ? []
                : getRuntimeImageModelCandidates('auto', mode === 'generate' ? 'generate' : 'edit'),
              async (candidate: typeof initialRuntime) => {
                itemRuntime = candidate;
                return mode === 'edit'
                  ? editImage(candidate.provider, candidate.model.rawId, { prompt: itemPrompt, aspectRatio, count, references: imageReferences, fidelity: 'high' }, requestController.signal)
                  : generateImage(candidate.provider, candidate.model.rawId, { prompt: itemPrompt, aspectRatio, count, references: imageReferences }, requestController.signal);
              },
            );
            void observer?.emit({ operationId: providerOperationId, kind: 'provider', phase: 'completed', at: Date.now(), durationMs: Date.now() - providerStartedAt, status: 'completed', identity: String((itemRuntime.provider as { name?: unknown }).name || 'image') });
            return itemImages.map((image: RuntimeImage) => ({
              ...image,
              itemRuntime,
              ...(batchId ? { batchId, batchIndex: promptIndex, batchTotal: prompts.length, batchPrompt: itemPrompt } : {}),
            }));
          } catch (error) {
            void observer?.emit({ operationId: providerOperationId, kind: 'provider', phase: 'failed', at: Date.now(), durationMs: Date.now() - providerStartedAt, status: 'failed', identity: String((itemRuntime.provider as { name?: unknown }).name || 'image'), errorClass: error instanceof Error ? error.name : 'UnknownError' });
            throw error;
          }
        };
        const resultsByPrompt: RuntimeImage[][] = Array.from({ length: prompts.length }, () => []);
        let nextPromptIndex = 0;
        const worker = async () => {
          while (true) {
            const promptIndex = nextPromptIndex;
            nextPromptIndex += 1;
            if (promptIndex >= prompts.length) return;
            try {
              resultsByPrompt[promptIndex] = await runPrompt(prompts[promptIndex], promptIndex);
              batchItems.push({
                batchId: batchId || `agent-single-${Date.now()}`,
                index: promptIndex,
                total: prompts.length,
                prompt: prompts[promptIndex],
                status: 'succeeded',
                imageCount: resultsByPrompt[promptIndex].length,
              });
            } catch (error) {
              if ((error as { providerPossiblyAccepted?: boolean; providerAcceptedTask?: boolean } | null)?.providerPossiblyAccepted
                || (error as { providerAcceptedTask?: boolean } | null)?.providerAcceptedTask) throw error;
              resultsByPrompt[promptIndex] = [];
              batchItems.push({
                batchId: batchId || `agent-single-${Date.now()}`,
                index: promptIndex,
                total: prompts.length,
                prompt: prompts[promptIndex],
                status: 'failed',
                error: error instanceof Error ? error.message : '图片生成失败',
              });
            }
          }
        };
        try {
          await Promise.all(Array.from({ length: Math.min(2, prompts.length) }, () => worker()));
        } catch (error) {
          if ((error as { providerPossiblyAccepted?: boolean; providerAcceptedTask?: boolean } | null)?.providerPossiblyAccepted
            || (error as { providerAcceptedTask?: boolean } | null)?.providerAcceptedTask) {
            const pendingTaskId = String((error as { providerTaskId?: unknown }).providerTaskId || '') || undefined;
            const pendingPatch = { status: 'pending' as const, mode: mode as 'generate' | 'edit', taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, durationMs: Date.now() - startedAt, error: '服务商已接收任务，正在生成，请勿重复提交。', ...(pendingTaskId ? { providerTaskId: pendingTaskId } : {}), ...taskContext };
            if (mediaLogId) await finishGenerationLog(mediaLogId, pendingPatch).catch(() => undefined);
            else await appendGenerationLog(pendingPatch).catch(() => undefined);
          }
          throw error;
        }
        images.push(...resultsByPrompt.flat());
        if (!images.length) {
          const details = batchItems
            .filter((item) => item.status === 'failed' && item.error)
            .sort((a, b) => Number(a.index) - Number(b.index))
            .map((item) => `${Number(item.index) + 1}：${String(item.error)}`)
            .join('；');
          throw new Error(details
            ? `图片服务未返回可交付结果：${details}`
            : '图片服务没有返回图片，本轮未生成成功');
        }
        selectedImageRuntime = images.find((image) => image.itemRuntime)?.itemRuntime || initialRuntime;
        if (requestController.signal.aborted && !images.length) throw requestController.signal.reason || new Error('AGENT_CANCELLED');
        const providerFinishedAt = Date.now();
        const stored = await persistGenerationResult({
          images,
          storagePath: executionPublicState.settings.imageStoragePath,
          startedAt,
          providerFinishedAt,
          downloadAuth: imageDownloadAuth(selectedImageRuntime.provider),
          ...(mediaLogId ? { logId: mediaLogId } : { log: { mode, taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, references: referenceRecords.length ? referenceRecords : undefined, ...taskContext } }),
        });
        if (!stored.images.length) throw new Error('图片结果未能保存，本轮没有可交付的图片');
        generated.push(...stored.images.map((image: RuntimeImage, index: number) => {
          const itemRuntime = images[index]?.itemRuntime || selectedImageRuntime;
          return {
          ...image,
          modelId: itemRuntime.model.id,
          modelName: itemRuntime.model.displayName,
          providerName: String((itemRuntime.provider as { name?: unknown }).name || ''),
          ...(batchId ? {
            batchId,
            batchIndex: images[index]?.batchIndex,
            batchTotal: prompts.length,
            batchPrompt: images[index]?.batchPrompt || prompt,
            batchStatus: 'succeeded',
          } : {}),
          };
        }));
        generations.push({ prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), mode });
        // 把本地引用回给模型：它是后面把这些图放进 Word / PPT 的唯一合法 ref。
        const storedRefs = stored.images.map((image) => String(image?.url || '')).filter(Boolean);
        results.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: true,
            count: images.length,
            ...(batchItems.length ? { batchItems: batchItems.filter((item) => !batchId || item.batchId === batchId).sort((a, b) => Number(a.index) - Number(b.index)) } : {}),
            model: selectedImageRuntime.model.displayName,
            mode,
            ...(storedRefs.length
              ? {
                images: storedRefs.map((ref: string) => ({ ref })),
                instruction: '要把这些图放进 Word/PPT 时，把 ref 原样传给 document_generate 或 presentation_generate，不要自己编 ref。',
              }
              : {}),
          }),
        });
      } catch (error) {
        const possiblyAccepted = Boolean((error as { providerPossiblyAccepted?: boolean; providerAcceptedTask?: boolean } | null)?.providerPossiblyAccepted || (error as { providerAcceptedTask?: boolean } | null)?.providerAcceptedTask);
        if (requestController.signal.aborted && !possiblyAccepted) {
          if (requestController.signal.aborted) throw requestController.signal.reason || error;
        }
        const message = possiblyAccepted ? '服务商已接收图片任务，正在生成，请勿重复提交。' : error instanceof Error ? error.message : '图片工具失败';
        const failurePatch = { status: possiblyAccepted ? 'pending' as const : 'error' as const, mode: mode as 'generate' | 'edit', taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, durationMs: Date.now() - startedAt, error: message, ...taskContext };
        if (mediaLogId) await finishGenerationLog(mediaLogId, failurePatch).catch(() => undefined);
        else await appendGenerationLog(failurePatch).catch(() => undefined);
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, pending: possiblyAccepted, error: message, ...(batchItems.length ? { batchItems } : {}) }) });
      }

  Object.assign(state, { generated, preparedCaption, batchItems, generations });
  return { results };
}
