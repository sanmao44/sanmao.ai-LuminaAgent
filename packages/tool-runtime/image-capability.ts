import type { ChatMessage } from '../contracts/chat';
import type { ToolCall, RuntimeImage, ToolRuntimeState } from './capability-state';
import type { RuntimeObserver } from '../contracts/observability';
import type { CreativeReviewEvidence, CreativeReviewReport } from '../contracts/creative-review';
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
  requestedImageCapability?: 'generate' | 'edit' | 'reference';
  latestRefs: readonly Record<string, unknown>[];
  trackedChatCompletion: (provider: unknown, model: string, payload: Record<string, unknown>, signal?: AbortSignal) => Promise<{ choices?: Array<{ message?: { content?: unknown } }> } | null>;
  agentRuntime: { provider: unknown; model: { rawId: string } };
  requestedAgentImageModelId?: string;
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
  generateImageWithReferences: (provider: unknown, model: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<RuntimeImage[]>;
  persistGenerationResult: (options: Record<string, unknown>) => Promise<{ images: RuntimeImage[] }>;
  reviewImageArtifact?: (input: { artifactRef: string; expectedAspectRatio?: string; storagePath?: string; brief?: string; generationPrompt?: string; signal?: AbortSignal }) => Promise<CreativeReviewReport>;
  imageDownloadAuth: (provider: unknown) => unknown;
  finishGenerationLog: (id: string, patch: Record<string, unknown>) => Promise<void>;
  latestInstruction?: string;
  agentRunId?: string;
  /** Canvas image edits already have an explicit target and prompt. They do
   * not need a preliminary chat completion for captioning. */
  skipCaption?: boolean;
  executionPublicState: { settings: { imageStoragePath?: string } };
};

export type ImageCapabilityInput = {
  state: ToolRuntimeState & Record<string, unknown>;
  call: ToolCall;
  args: Record<string, unknown>;
  results: ChatMessage[];
  ports: ImageCapabilityPorts;
};

type ImageModelOperation = 'generate' | 'edit' | 'reference-generate';
type ImageModelCandidate = RuntimeImage & { operation: ImageModelOperation };

function imageOperationForCapability(capability: 'generate' | 'edit' | 'reference'): ImageModelOperation {
  return capability === 'reference' ? 'reference-generate' : capability;
}

function imageCandidateKey(candidate: ImageModelCandidate) {
  return `${candidate.model.id}:${candidate.operation}`;
}

function creativeReviewEvidence(report: CreativeReviewReport) {
  return [...report.capability.evidence, ...report.safety.evidence];
}

function hasCreativeReviewFailure(report: CreativeReviewReport) {
  return creativeReviewEvidence(report).some((item) => item.status === 'fail');
}

type ConfirmedCreativeReviewFindings = {
  artifactRef: string;
  mediaKind: CreativeReviewReport['mediaKind'];
  findings: CreativeReviewEvidence[];
};

/** Give the model only actionable evidence while retaining the full report for the UI and internal log. */
function projectConfirmedCreativeReview(report: CreativeReviewReport): ConfirmedCreativeReviewFindings {
  return {
    artifactRef: report.artifactRef,
    mediaKind: report.mediaKind,
    findings: creativeReviewEvidence(report).filter((item) => item.status === 'fail'),
  };
}

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
    trackedChatCompletion, agentRuntime, requestedAgentImageModelId, getRuntimeImageGenerationModel,
    getRuntimeImageModelForCapability, appendGenerationLog, sourceForLog, taskContext, startGenerationLog,
    referenceRecords, getRuntimeImageModelCandidates, editImage, generateImage, generateImageWithReferences,
    persistGenerationResult, imageDownloadAuth, finishGenerationLog, reviewImageArtifact, latestInstruction, agentRunId, skipCaption, executionPublicState,
  } = input.ports;
  let { generated, preparedCaption, batchItems, generations } = state;
      const startedAt = Date.now();
      const promptBatch = normalizeImagePromptBatch({ args, latestInstruction: latestInstruction || '', batchPlanContent, fallbackImagePrompt, isBareImageExecution, extractBatchPrompts });
      const { effectiveRequestedPrompts, prompts, prompt, count } = promptBatch;
      const aspectRatio = String(
        latestInstruction?.match(/\b(?:1:1|2:3|3:2|3:4|4:3|9:16|16:9|21:9)\b/g)?.at(-1)
          || fallbackImagePrompt.match(/\b(?:1:1|2:3|3:2|3:4|4:3|9:16|16:9|21:9)\b/g)?.at(-1)
          || args.aspectRatio
          || '自动',
      );
      // Reference generation is a distinct operation; its provider adapter
      // chooses the correct native image-input contract without changing task semantics.
      const requestedMode = requestedImageCapability
        ? requestedImageCapability === 'edit' ? 'edit' : 'generate'
        : call.function?.name === 'image_edit' ? 'edit' : 'generate';
      if (latestRefs.some((reference: { kind?: string }) => reference.kind === 'video')) {
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: '图片模型不能接收视频引用；请改用视频生成输入或移除视频引用。' }) });
        return { results };
      }
      if (!preparedCaption) {
        if (skipCaption) {
          preparedCaption = Promise.resolve('\u56fe\u7247\u5df2\u751f\u6210\u3002');
        } else {
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
      }
      // Model selection is controlled by the client/system settings. Never let
      // the language model override the configured default through tool args.
      const requestedImageModelId = requestedAgentImageModelId;
      const requestedCapability = requestedImageCapability || (requestedMode === 'edit' ? 'edit' : 'generate');
      const imageReferences = latestRefs.flatMap((reference) =>
        reference.kind === 'image' && typeof reference.url === 'string' ? [reference.url] : []);
      const hasImageReferences = imageReferences.length > 0;
      // An edit cannot be performed without source pixels. Keep the task moving
      // with a clearly labeled text-to-image result instead of returning a
      // tool error or pretending the original image was edited.
      const requiredImageCapability = requestedCapability !== 'generate' && !hasImageReferences
        ? 'generate'
        : requestedCapability;
      const requestedOperation = requestedCapability === 'reference'
        ? 'reference-generate'
        : requestedCapability;
      const strategyCapabilities: Array<'edit' | 'reference' | 'generate'> = requiredImageCapability === 'edit'
        ? ['edit', 'reference', 'generate']
        : requiredImageCapability === 'reference' ? ['reference', 'generate'] : ['generate'];
      let imageRuntime: ImageModelCandidate | null = null;
      for (const capability of strategyCapabilities) {
        const runtime = capability === 'generate'
          ? await getRuntimeImageGenerationModel(requestedImageModelId)
          : await getRuntimeImageModelForCapability(requestedImageModelId, capability);
        if (runtime) {
          imageRuntime = { ...runtime, operation: imageOperationForCapability(capability) };
          break;
        }
        if (requestedImageModelId !== 'auto') {
          const automatic = capability === 'generate'
            ? await getRuntimeImageGenerationModel('auto')
            : await getRuntimeImageModelForCapability('auto', capability);
          if (automatic) {
            imageRuntime = { ...automatic, operation: imageOperationForCapability(capability) };
            break;
          }
        }
      }
      if (!imageRuntime) {
        const diagnosis = '当前模型库没有可用的图片生成或图片处理模型。请检查图片模型是否已启用、已发布，所属服务商是否可用。';
        await appendGenerationLog({ status: 'error', mode: requestedMode, operation: requiredImageCapability, source: sourceForLog, prompt, aspectRatio, count, durationMs: Date.now() - startedAt, error: '没有可用的图片模型', ...taskContext }).catch(() => undefined);
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ ok: false, error: diagnosis, diagnosis }) });
        return { results };
      }
      let operation: ImageModelOperation = imageRuntime.operation;
      let mode: 'generate' | 'edit' = operation === 'edit' ? 'edit' : 'generate';
      let selectedImageRuntime: ImageModelCandidate = imageRuntime;
      const mediaLogId = await startGenerationLog({
        mode,
        operation,
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
              async () => {
                const fallbacks: ImageModelCandidate[] = [];
                const seen = new Set<string>([imageCandidateKey(initialRuntime)]);
                for (const capability of strategyCapabilities) {
                  const candidates = await getRuntimeImageModelCandidates(requestedAgentImageModelId || 'auto', capability);
                  for (const candidate of candidates) {
                    if (candidate.model.capabilities && !candidate.model.capabilities.includes(capability)) continue;
                    const planned = { ...candidate, operation: imageOperationForCapability(capability) };
                    const key = imageCandidateKey(planned);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    fallbacks.push(planned);
                  }
                }
                return fallbacks;
              },
              async (candidate: typeof initialRuntime) => {
                itemRuntime = candidate;
                const candidateImages = candidate.operation === 'edit'
                  ? editImage(candidate.provider, candidate.model.rawId, { prompt: itemPrompt, aspectRatio, count, references: imageReferences, fidelity: 'high' }, requestController.signal)
                  : candidate.operation === 'reference-generate'
                    ? generateImageWithReferences(candidate.provider, candidate.model.rawId, { prompt: itemPrompt, aspectRatio, count, references: imageReferences }, requestController.signal)
                    : generateImage(candidate.provider, candidate.model.rawId, {
                      prompt: itemPrompt,
                      aspectRatio,
                      count,
                      references: requestedCapability === 'generate' ? imageReferences : [],
                    }, requestController.signal);
                const images = await candidateImages;
                if (!images.length) {
                  throw Object.assign(new Error('图片模型没有返回可交付图片'), { mediaModelNoOutput: true });
                }
                return images;
              },
              { allowFallbackBeforeProviderSubmission: true, candidateKey: imageCandidateKey },
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
            const pendingPatch = { status: 'pending' as const, mode: mode as 'generate' | 'edit', operation, taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, durationMs: Date.now() - startedAt, error: '服务商已接收任务，正在生成，请勿重复提交。', ...(pendingTaskId ? { providerTaskId: pendingTaskId } : {}), ...taskContext };
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
        const successfulRuntime = images.find((image) => image.itemRuntime)?.itemRuntime;
        if (successfulRuntime) {
          selectedImageRuntime = successfulRuntime as ImageModelCandidate;
          operation = selectedImageRuntime.operation;
          mode = operation === 'edit' ? 'edit' : 'generate';
        }
        if (skipCaption) {
          const usedRequestedOperation = operation === requestedOperation;
          preparedCaption = Promise.resolve(usedRequestedOperation
            ? '图片已按当前请求生成。'
            : operation === 'reference-generate'
              ? '已自动切换到参考图生成模型，基于所选图片生成了新图。'
              : operation === 'generate'
                ? !hasImageReferences && requestedOperation === 'edit'
                  ? '本轮没有可用的原图素材，已按描述生成新图；该结果不是对原图的直接编辑。'
                  : '当前没有可用的图片编辑接口，已自动切换到生图模型生成新图；该结果不是对原图的直接编辑。'
                : '已自动切换到兼容的图片模型完成处理。');
        }
        if (requestController.signal.aborted && !images.length) throw requestController.signal.reason || new Error('AGENT_CANCELLED');
        const providerFinishedAt = Date.now();
        const stored = await persistGenerationResult({
          images,
          storagePath: executionPublicState.settings.imageStoragePath,
          startedAt,
          providerFinishedAt,
          downloadAuth: imageDownloadAuth(selectedImageRuntime.provider),
          ...(mediaLogId ? { logId: mediaLogId } : { log: { mode, operation, taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, references: referenceRecords.length ? referenceRecords : undefined, ...taskContext } }),
        });
        if (!stored.images.length) throw new Error('图片结果未能保存，本轮没有可交付的图片');
        const generatedImageOutputs: Array<Record<string, unknown>> = stored.images.map((image: RuntimeImage, index: number) => {
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
        });
        generated.push(...generatedImageOutputs);
        generations.push({ prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), mode });
        // 把本地引用回给模型：它是后面把这些图放进 Word / PPT 的唯一合法 ref。
        const storedRefs = stored.images.map((image) => String(image?.url || '')).filter(Boolean);
        const creativeReviews = reviewImageArtifact
          ? await Promise.all(stored.images.map((image, index) => reviewImageArtifact({
            artifactRef: String(image?.url || ''),
            expectedAspectRatio: aspectRatio,
            storagePath: executionPublicState.settings.imageStoragePath,
            brief: String(latestInstruction || '').slice(0, 4000),
            generationPrompt: String(images[index]?.batchPrompt || prompt).slice(0, 4000),
            signal: requestController.signal,
          })))
          : [];
        if (mediaLogId && creativeReviews.length) {
          await finishGenerationLog(mediaLogId, { creativeReview: creativeReviews }).catch(() => undefined);
        }
        creativeReviews.forEach((report, index) => {
          if (generatedImageOutputs[index] && hasCreativeReviewFailure(report)) generatedImageOutputs[index].creativeReview = report;
        });
        // The full report remains available to the validator-backed UI and internal log.
        // Only the model-facing tool result gets a failure-only projection.
        const confirmedCreativeReviewFindings = creativeReviews
          .filter(hasCreativeReviewFailure)
          .map(projectConfirmedCreativeReview);
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
                ...(confirmedCreativeReviewFindings.length ? { creativeReviewFindings: confirmedCreativeReviewFindings } : {}),
                instruction: '要把这些图放进 Word/PPT 时，把 ref 原样传给 document_generate 或 presentation_generate，不要自己编 ref。',
              }
              : {}),
          }),
        });
      } catch (error) {
        const possiblyAccepted = Boolean((error as { providerPossiblyAccepted?: boolean; providerAcceptedTask?: boolean } | null)?.providerPossiblyAccepted || (error as { providerAcceptedTask?: boolean } | null)?.providerAcceptedTask);
        const pendingProviderTaskId = possiblyAccepted
          ? String((error as { providerTaskId?: unknown } | null)?.providerTaskId || '').trim()
          : '';
        if (requestController.signal.aborted && !possiblyAccepted) {
          if (requestController.signal.aborted) throw requestController.signal.reason || error;
        }
        const message = possiblyAccepted ? '服务商已接收图片任务，正在生成，请勿重复提交。' : error instanceof Error ? error.message : '图片工具失败';
        const failurePatch = { status: possiblyAccepted ? 'pending' as const : 'error' as const, mode: mode as 'generate' | 'edit', operation, taskKind: 'media' as const, source: sourceForLog, prompt, aspectRatio, modelId: selectedImageRuntime.model.id, modelName: selectedImageRuntime.model.displayName, providerName: String((selectedImageRuntime.provider as { name?: unknown }).name || ''), count, durationMs: Date.now() - startedAt, error: message, ...(pendingProviderTaskId ? { providerTaskId: pendingProviderTaskId } : {}), ...taskContext };
        if (mediaLogId) await finishGenerationLog(mediaLogId, failurePatch).catch(() => undefined);
        else await appendGenerationLog(failurePatch).catch(() => undefined);
        // The media log is the durable task record that the Canvas recovery
        // endpoint can query. Keep it separate from the Agent run id carried
        // in taskContext: those ids represent different lifecycles.
        results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({
          ok: false,
          pending: possiblyAccepted,
          error: message,
          ...(possiblyAccepted && mediaLogId ? {
            generationTaskId: mediaLogId,
            mediaLogId,
          } : {}),
          ...(pendingProviderTaskId ? { providerTaskId: pendingProviderTaskId } : {}),
          ...(batchItems.length ? { batchItems } : {}),
        }) });
      }

  Object.assign(state, { generated, preparedCaption, batchItems, generations });
  return { results };
}
