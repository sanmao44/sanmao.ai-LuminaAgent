import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Module from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const root = process.cwd();
const providerPath = path.join(root, 'lib/claude-code-provider.ts');
const schemaPath = path.join(root, 'lib/claude-code-tool-schema.ts');

async function compileTypeScriptModule(filename, replacements = {}) {
  const source = await readFile(filename, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (parent?.filename === filename && Object.hasOwn(replacements, request)) return replacements[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(compiled, filename);
    return loaded.exports;
  } finally {
    Module._load = originalLoad;
  }
}

test('Claude Code tool_use is handed to SANMAO before any SDK tool handler runs', async () => {
  const schema = await compileTypeScriptModule(schemaPath);
  let capturedOptions;
  let capturedPrompt;
  let sdkHandlerCalls = 0;
  const sdk = {
    tool(name, description, inputSchema, handler) {
      return {
        name,
        description,
        inputSchema,
        handler: async (...args) => {
          sdkHandlerCalls += 1;
          return handler(...args);
        },
      };
    },
    createSdkMcpServer(options) {
      return options;
    },
    query(params) {
      capturedOptions = params.options;
      capturedPrompt = params.prompt;
      const [sdkTool] = params.options.mcpServers.sanmao.tools;
      const toolName = `mcp__sanmao__${sdkTool.name}`;
      async function* messages() {
        yield {
          type: 'assistant',
          parent_tool_use_id: null,
          message: { content: [
            { type: 'text', text: 'I will search for that.' },
            { type: 'tool_use', id: 'sdk-call-1', name: toolName, input: { query: 'Claude Code integration' } },
          ] },
        };
        const hook = params.options.hooks.PreToolUse[0].hooks[0];
        const result = await hook({
          hook_event_name: 'PreToolUse',
          tool_name: toolName,
          tool_input: { query: 'Claude Code integration' },
          tool_use_id: 'sdk-call-1',
        }, 'sdk-call-1', { signal: params.options.abortController.signal });
        assert.equal(result.hookSpecificOutput.permissionDecision, 'deny');
        throw new Error('SDK query interrupted after host handoff');
      }
      return messages();
    },
  };
  const { invokeClaudeCodeProvider } = await compileTypeScriptModule(providerPath, {
    '@anthropic-ai/claude-agent-sdk': sdk,
    './claude-code-tool-schema': schema,
  });

  process.env.SANMAO_PROVIDER_TEST_SECRET = 'must-not-enter-child-environment';
  try {
    const response = await invokeClaudeCodeProvider({
      id: 'claude-provider',
      name: '65535-Claude',
      type: 'openai-compatible',
      platform: '65535',
      baseUrl: 'https://api2-cn.65535.space/v1',
      apiKey: 'local-test-key',
    }, 'claude-sonnet-5-5', {
      messages: [
        { role: 'system', content: 'Use the provided tool when needed.' },
        { role: 'user', content: [
          { type: 'text', text: 'Search for the Claude Code integration.' },
          { type: 'image_url', image_url: { url: 'https://images.example.test/reference.png' } },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } },
        ] },
      ],
      tools: [{
        type: 'function',
        function: { name: 'web_search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
      }],
      tool_choice: 'auto',
    });

    assert.equal(response.model, 'claude-sonnet-5-5');
    assert.equal(response.choices[0].finish_reason, 'tool_calls');
    assert.deepEqual(response.choices[0].message.tool_calls, [{
      id: 'sdk-call-1',
      type: 'function',
      function: { name: 'web_search', arguments: '{"query":"Claude Code integration"}' },
    }]);
    assert.equal(response.choices[0].message.content, 'I will search for that.');
    assert.equal(sdkHandlerCalls, 0);
    const prompts = [];
    for await (const prompt of capturedPrompt) prompts.push(prompt);
    assert.deepEqual(prompts, [{
      type: 'user',
      message: { role: 'user', content: [
        { type: 'text', text: '[user]\n' },
        { type: 'text', text: 'Search for the Claude Code integration.' },
        { type: 'image', source: { type: 'url', url: 'https://images.example.test/reference.png' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
      ] },
      parent_tool_use_id: null,
    }]);
    assert.equal(capturedOptions.env.ANTHROPIC_BASE_URL, 'https://api2-cn.65535.space');
    assert.equal(capturedOptions.env.ANTHROPIC_AUTH_TOKEN, 'local-test-key');
    assert.equal(capturedOptions.env.SANMAO_PROVIDER_TEST_SECRET, undefined);
    assert.equal(capturedOptions.tools.length, 0);
    assert.equal(capturedOptions.maxTurns, 5);
    assert.deepEqual(capturedOptions.settingSources, []);
    assert.deepEqual(capturedOptions.allowedTools, ['mcp__sanmao__tool_0']);
    assert.equal(capturedOptions.permissionMode, 'dontAsk');
    assert.equal(capturedOptions.title, 'SANMAO.AI');
    assert.equal(capturedOptions.abortController.signal.aborted, true);
    assert.equal(await import('node:fs/promises').then(({ stat }) => stat(capturedOptions.cwd).then(() => true, () => false)), false);
    await assert.rejects(invokeClaudeCodeProvider({
      id: 'claude-provider',
      name: '65535-Claude',
      type: 'openai-compatible',
      platform: '65535',
      baseUrl: 'https://api2-cn.65535.space/v1',
      apiKey: 'local-test-key',
    }, 'claude-sonnet-5-5', {
      messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: 'https://media.example.test/clip.mp4' } }] }],
    }), /Claude Code does not support video input/);
  } finally {
    delete process.env.SANMAO_PROVIDER_TEST_SECRET;
  }
});

test('Claude Code SDK turn-limit results are returned as provider failures', async () => {
  const schema = await compileTypeScriptModule(schemaPath);
  const sdk = {
    tool() { throw new Error('No tools are expected for this response.'); },
    createSdkMcpServer() { throw new Error('No MCP server is expected for this response.'); },
    query(params) {
      assert.equal(params.options.maxTurns, 5);
      return (async function* messages() {
        yield {
          type: 'result',
          subtype: 'error_max_turns',
          is_error: true,
          errors: ['Reached maximum number of turns (5)'],
        };
      })();
    },
  };
  const { invokeClaudeCodeProvider } = await compileTypeScriptModule(providerPath, {
    '@anthropic-ai/claude-agent-sdk': sdk,
    './claude-code-tool-schema': schema,
  });

  await assert.rejects(invokeClaudeCodeProvider({
    id: 'claude-provider',
    name: '65535-Claude',
    type: 'openai-compatible',
    platform: '65535',
    baseUrl: 'https://api2-cn.65535.space/v1',
    apiKey: 'local-test-key',
  }, 'claude-sonnet-5-5', {
    messages: [{ role: 'user', content: 'Generate an animated SVG file.' }],
  }), /Reached maximum number of turns \(5\)/);
});
