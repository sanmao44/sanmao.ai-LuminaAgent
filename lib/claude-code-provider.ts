import { createSdkMcpServer, query, tool, type HookInput, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSdkToolSchema } from './claude-code-tool-schema';
import type { ChatMessage, RuntimeProvider } from './providers';

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };
type ClaudeResponse = {
  model: string;
  choices: Array<{ index: number; message: { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }; finish_reason: 'stop' | 'tool_calls' }>;
};

const HANDOFF_ABORT = 'SANMAO_CLAUDE_TOOL_HANDOFF';
const MAX_CLAUDE_AGENT_TURNS = 5;
const ENVIRONMENT_KEYS = ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'ComSpec', 'PATHEXT'] as const;

function childEnvironment(provider: RuntimeProvider, configDirectory: string) {
  const inherited = Object.fromEntries(ENVIRONMENT_KEYS.flatMap((key) => {
    const value = process.env[key];
    return value ? [[key, value]] : [];
  }));
  return {
    ...inherited,
    ANTHROPIC_BASE_URL: provider.baseUrl.replace(/\/+$/, '').replace(/\/v1$/i, ''),
    ANTHROPIC_AUTH_TOKEN: provider.apiKey,
    CLAUDE_CONFIG_DIR: configDirectory,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'SANMAO.AI',
  };
}

function contentText(content: ChatMessage['content']) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((part) => part.type === 'text').map((part) => part.text).filter(Boolean).join('\n');
}

type PromptBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'url'; url: string } | { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } };

function imageBlock(value: string): PromptBlock {
  const dataUrl = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (dataUrl) {
    const mediaType = dataUrl[1].toLowerCase();
    if (mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/gif' || mediaType === 'image/webp') {
      return { type: 'image', source: { type: 'base64', media_type: mediaType, data: dataUrl[2] } };
    }
  }
  if (value.startsWith('data:')) {
    throw new Error('Claude Code image input must be a base64 JPEG, PNG, GIF, or WebP image.');
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Claude Code image input must use an HTTP or HTTPS URL.');
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Claude Code image input must use an HTTP or HTTPS URL without embedded credentials.');
  }
  return { type: 'image', source: { type: 'url', url: url.toString() } };
}

function promptFor(messages: ChatMessage[]) {
  const system = messages.filter((message) => message.role === 'system').map((message) => contentText(message.content)).filter(Boolean).join('\n\n');
  const blocks: PromptBlock[] = [];
  for (const message of messages.filter((item) => item.role !== 'system')) {
    blocks.push({ type: 'text', text: `[${message.role}]\n` });
    if (typeof message.content === 'string') {
      if (message.content) blocks.push({ type: 'text', text: message.content });
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === 'text') {
          if (part.text) blocks.push({ type: 'text', text: part.text });
        } else if (part.type === 'image_url') {
          blocks.push(imageBlock(part.image_url.url));
        } else {
          throw new Error('Claude Code does not support video input.');
        }
      }
    }
    if (message.tool_calls?.length) blocks.push({ type: 'text', text: `\n[tool calls] ${JSON.stringify(message.tool_calls)}` });
    if (message.tool_call_id) blocks.push({ type: 'text', text: `\n[tool call id] ${message.tool_call_id}` });
  }
  if (!blocks.length) blocks.push({ type: 'text', text: '[user]\n' });
  const prompt = (async function* (): AsyncIterable<SDKUserMessage> {
    yield { type: 'user', message: { role: 'user', content: blocks }, parent_tool_use_id: null };
  })();
  return { system, prompt };
}

function toolParameters(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function assistantBlocks(message: SDKMessage) {
  if (message.type !== 'assistant' || message.parent_tool_use_id !== null) return [];
  return Array.isArray(message.message.content) ? message.message.content : [];
}

export async function invokeClaudeCodeProvider(
  provider: RuntimeProvider,
  rawModelId: string,
  payload: { messages: ChatMessage[]; tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>; tool_choice?: 'auto' | 'none' },
  signal?: AbortSignal,
): Promise<ClaudeResponse> {
  const controller = new AbortController();
  const abortParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortParent();
  else signal?.addEventListener('abort', abortParent, { once: true });

  const handoffTools = new Map<string, string>();
  const toolValidators = new Map<string, (input: unknown) => boolean>();
  const sdkTools = (payload.tool_choice === 'none' ? [] : payload.tools || []).flatMap((definition, index) => {
    const originalName = definition?.function?.name;
    if (!originalName || !/^[A-Za-z0-9_-]{1,64}$/.test(originalName)) return [];
    const converted = createSdkToolSchema(definition.function.parameters);
    if (!converted.supported) return [];
    const sdkName = `tool_${index}`;
    const name = `mcp__sanmao__${sdkName}`;
    handoffTools.set(name, originalName);
    toolValidators.set(name, converted.validate);
    return [tool(sdkName, definition.function.description || originalName, converted.shape, async () => ({
      content: [{ type: 'text', text: 'Tool execution is handled by the SANMAO host.' }],
    }))];
  });

  let capturedCall: ToolCall | undefined;
  let assistantText = '';
  let sdkFailure: string | undefined;
  const handoffHook = async (input: HookInput) => {
    if (input.hook_event_name !== 'PreToolUse') return { continue: true };
    const name = handoffTools.get(input.tool_name);
    const args = toolParameters(input.tool_input);
    if (!name || !args) return { decision: 'block' as const, reason: 'Unregistered SANMAO tool call.' };
    if (!toolValidators.get(input.tool_name)?.(args)) return { decision: 'block' as const, reason: 'Tool arguments did not match the SANMAO schema.' };
    capturedCall = {
      id: input.tool_use_id,
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    };
    controller.abort(new Error(HANDOFF_ABORT));
    return { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'deny' as const, permissionDecisionReason: 'Hand off this call to the SANMAO tool runtime.' } };
  };

  const { system, prompt } = promptFor(payload.messages);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sanmao-claude-'));
  const configDirectory = path.join(temporaryRoot, 'config');
  try {
    const mcpServer = sdkTools.length ? createSdkMcpServer({ name: 'sanmao', version: '1.0.0', tools: sdkTools }) : undefined;
    const stream = query({
      prompt,
      options: {
        abortController: controller,
        cwd: temporaryRoot,
        env: childEnvironment(provider, configDirectory),
        model: rawModelId,
        title: 'SANMAO.AI',
        systemPrompt: { type: 'custom', prompt: system || 'You are SANMAO.AI, a helpful assistant.' },
        settingSources: [],
        persistSession: false,
        maxTurns: MAX_CLAUDE_AGENT_TURNS,
        tools: [],
        allowedTools: sdkTools.map((item) => `mcp__sanmao__${item.name}`),
        permissionMode: 'dontAsk',
        ...(mcpServer ? { mcpServers: { sanmao: mcpServer } } : {}),
        hooks: {
          PreToolUse: [{ hooks: [handoffHook], onFailure: 'block' }],
        },
      },
    });

    try {
      for await (const message of stream) {
        if (message.type === 'result') {
          if (message.subtype !== 'success') {
            sdkFailure = message.errors.filter(Boolean).join('; ') || `Claude Code stopped with ${message.subtype}.`;
          } else if (!assistantText && message.result) {
            assistantText = message.result;
          }
        }
        for (const block of assistantBlocks(message)) {
          if (block.type === 'text' && typeof block.text === 'string') assistantText += block.text;
        }
      }
    } catch (error) {
      if (!capturedCall || !controller.signal.aborted || signal?.aborted) throw error;
    }
    if (signal?.aborted) throw signal.reason || new Error('Claude Code request was cancelled.');
    if (sdkFailure) throw new Error(sdkFailure);
    const toolCalls = capturedCall ? [capturedCall] : undefined;
    return {
      model: rawModelId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: assistantText || null, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? 'tool_calls' : 'stop',
      }],
    };
  } finally {
    signal?.removeEventListener('abort', abortParent);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
