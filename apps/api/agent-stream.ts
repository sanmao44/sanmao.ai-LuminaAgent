import { describeProviderFailure } from '../../lib/providers';
import { hasInlineToolCallMarkup } from '../../lib/agent/inline-tool-calls';
import { stripToolCallMarkup } from '../../lib/skills';
import type { AgentDeliverable } from '../../lib/agent-intent';
import type { WebSearchMeta, WebSearchDecisionMeta } from '../../lib/types';
import type { CanvasPatch } from '../../lib/canvas/patch';
import type { ToolLoopTraceStep } from '../../packages/tool-runtime/tool-loop';

export type GeneratedFile = {
  name: string;
  mimeType: string;
  size: number;
  content?: string;
  encoding?: 'utf8' | 'base64';
  artifactId?: string;
  downloadUrl?: string;
};

export type MetadataValue<T> = T | (() => T);
export type AgentStreamMetadata = { images: Array<{ url: string; revisedPrompt?: string; modelId?: string; modelName?: string; providerName?: string; batchId?: string; batchIndex?: number; batchTotal?: number; batchPrompt?: string; batchStatus?: 'succeeded' | 'failed'; batchError?: string }>; batchItems?: Array<{ batchId: string; index: number; total: number; prompt: string; status: 'succeeded' | 'failed'; error?: string; imageCount?: number }>; files: GeneratedFile[]; generations: Array<{ prompt: string; aspectRatio: string; modelId: string; modelName: string; providerName: string; mode: 'generate' | 'edit' }>; model: MetadataValue<string>; modelId?: MetadataValue<string | undefined>; providerName?: MetadataValue<string | undefined>; fallbackFrom?: MetadataValue<string | undefined>; deliverable: AgentDeliverable; durationSeconds?: number; fallback?: string; webSearch?: WebSearchMeta | null; webSearchDecision?: WebSearchDecisionMeta; statuses?: Array<Record<string, unknown>>; skills?: Array<{ id: string; name: string }>; mcpTools?: Array<{ server: string; name: string; readOnly: boolean; ok: boolean }>; toolTrace?: ToolLoopTraceStep[]; canvasPatch?: CanvasPatch; finalize?: (text: string) => Promise<string> | string; approval?: { id: string; expiresAt: number; message: string; calls: Array<Record<string, unknown>> }; streamBufferChars?: number; };

export type AgentUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number };
export type AgentStreamSettlement = { status: 'success' | 'error'; responseChars: number; error?: string } & AgentUsage;

export function streamAgentResult(upstream: Response | null | (() => Promise<Response | null>), metadata: AgentStreamMetadata, signal?: AbortSignal, onSettled?: (result: AgentStreamSettlement) => Promise<void> | void) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, event: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  let settled = false;
  const settle = async (result: AgentStreamSettlement) => {
    if (settled) return;
    settled = true;
    await onSettled?.(result);
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let text = '';
      let emitted = 0;
      let streamUsage: AgentUsage = {};
      const emitSafeText = () => {
        const clean = stripToolCallMarkup(text);
        const safe = clean.slice(0, Math.max(0, clean.length - (metadata.streamBufferChars ?? 96)));
        if (safe.length > emitted) {
          send(controller, { type: 'delta', text: safe.slice(emitted) });
          emitted = safe.length;
        }
      };
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      let settlement: AgentStreamSettlement = { status: 'error', responseChars: 0, error: '助手流式响应未完成' };
      const cancel = () => {
        void reader?.cancel().catch(() => undefined);
        try { controller.close(); } catch {}
      };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        if (signal?.aborted) {
          controller.close();
          return;
        }
        for (const status of metadata.statuses || [{ type: 'status', stage: 'answering', message: '正在准备回答…' }]) {
          if (signal?.aborted) return;
          send(controller, status);
        }
        const upstreamResponse = typeof upstream === 'function' ? await upstream() : upstream;
        if (!upstreamResponse?.body) {
          text = metadata.fallback || '';
          if (text) emitSafeText();
        } else {
          reader = upstreamResponse.body.getReader();
          let buffer = '';
          const consume = (raw: string) => {
            buffer += raw;
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';
            for (const event of events) {
              const dataLine = event.split(/\r?\n/).find((line) => line.startsWith('data:'));
              if (!dataLine) continue;
              const value = dataLine.slice(5).trim();
              if (!value || value === '[DONE]') continue;
              try {
                const parsed = JSON.parse(value);
                const payload = parsed?.data || parsed;
                const usage = payload?.usage;
                if (usage && typeof usage === 'object') {
                  const prompt = Number(usage.prompt_tokens ?? usage.input_tokens);
                  const completion = Number(usage.completion_tokens ?? usage.output_tokens);
                  const total = Number(usage.total_tokens);
                  const hasPrompt = Number.isFinite(prompt) && prompt >= 0;
                  const hasCompletion = Number.isFinite(completion) && completion >= 0;
                  const hasTotal = Number.isFinite(total) && total >= 0;
                  streamUsage = {
                    ...(hasPrompt ? { promptTokens: prompt } : {}),
                    ...(hasCompletion ? { completionTokens: completion } : {}),
                    ...(hasTotal ? { totalTokens: total } : hasPrompt && hasCompletion ? { totalTokens: prompt + completion } : {}),
                  };
                }
                const delta = payload?.choices?.[0]?.delta?.content || payload?.choices?.[0]?.message?.content || '';
                if (typeof delta === 'string' && delta) { text += delta; emitSafeText(); }
              } catch {}
            }
          };
          while (true) {
            if (signal?.aborted) return;
            const part = await reader.read();
            if (part.done) break;
            if (signal?.aborted) return;
            consume(decoder.decode(part.value, { stream: true }));
          }
          if (signal?.aborted) return;
          consume(decoder.decode());
          if (!text && buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer.trim().replace(/^data:\s*/, ''));
              const payload = parsed?.data || parsed;
              text = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.text || '';
              if (text) emitSafeText();
            } catch {}
          }
        }
        if (signal?.aborted) return;
        const streamedFinal = text || metadata.fallback || '';
        let finalized = streamedFinal;
        if (metadata.finalize) {
          try { finalized = await metadata.finalize(streamedFinal); }
          catch { finalized = streamedFinal; }
        }
        const cleanedFinal = stripToolCallMarkup(finalized).trim();
        const unexecutedCall = hasInlineToolCallMarkup(finalized) && !metadata.images.length && !metadata.files.length;
        const finalText = (!unexecutedCall && cleanedFinal) || (metadata.images.length || metadata.files.length
          ? `已完成${metadata.images.length ? ` ${metadata.images.length} 张图片` : ''}${metadata.files.length ? ` ${metadata.files.length} 个文件` : ''}。`
          : '当前模型未能完成这次请求，没有可交付的结果。请重试或切换支持工具调用的对话模型。');
        if (finalText.startsWith(text.slice(0, emitted)) && finalText.length > emitted) send(controller, { type: 'delta', text: finalText.slice(emitted) });
        if (metadata.approval) send(controller, { type: 'approval_required', approvalId: metadata.approval.id, runId: metadata.approval.id, summary: metadata.approval.message, approval: metadata.approval });
        const model = typeof metadata.model === 'function' ? metadata.model() : metadata.model;
        const modelId = typeof metadata.modelId === 'function' ? metadata.modelId() : metadata.modelId;
        const providerName = typeof metadata.providerName === 'function' ? metadata.providerName() : metadata.providerName;
        const fallbackFrom = typeof metadata.fallbackFrom === 'function' ? metadata.fallbackFrom() : metadata.fallbackFrom;
        send(controller, { type: 'final', message: finalText, images: metadata.images, ...(metadata.batchItems ? { batchItems: metadata.batchItems } : {}), files: metadata.files, generations: metadata.generations, model, ...(modelId ? { modelId } : {}), ...(providerName ? { providerName } : {}), ...(fallbackFrom ? { fallbackFrom } : {}), deliverable: metadata.deliverable, ...(metadata.durationSeconds !== undefined ? { durationSeconds: metadata.durationSeconds } : {}), ...(metadata.canvasPatch ? { canvasPatch: metadata.canvasPatch } : {}), webSearch: metadata.webSearch || null, webSearchDecision: metadata.webSearchDecision || null, skills: metadata.skills || [], mcpTools: metadata.mcpTools || [], toolTrace: metadata.toolTrace || [], ...(metadata.approval ? { approval: metadata.approval, needsApproval: true } : {}) });
        settlement = (!unexecutedCall && cleanedFinal) || metadata.images.length || metadata.files.length
          ? { status: 'success', responseChars: finalText.length, ...streamUsage }
          : { status: 'error', responseChars: finalText.length, error: finalText, ...streamUsage };
        controller.close();
      } catch (error) {
        const message = describeProviderFailure(error);
        settlement = { status: 'error', responseChars: text.length, error: signal?.aborted ? '本轮 Agent 已停止。' : message, ...streamUsage };
        if (signal?.aborted) return;
        send(controller, { type: 'error', message });
        controller.close();
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (signal?.aborted && settlement.status === 'success') settlement = { status: 'error', responseChars: text.length, error: '本轮 Agent 已停止。' };
        await settle(settlement);
      }
    },
    cancel() {
      void settle({ status: 'error', responseChars: 0, error: '客户端已关闭流式响应' });
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}
