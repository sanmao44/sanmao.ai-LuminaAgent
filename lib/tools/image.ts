import { defineTool, nativeToolId, TOOL_GATE } from './registry';

export const imageGenerateTool = defineTool({
  id: nativeToolId('image_generate'),
  // 调的是外部付费生成接口，不只是本机写文件。
  risk: 'external_side_effect',
  name: 'image_generate',
  description: '用户明确要求生成全新图片时调用。单张使用 prompt；一套详情图/多张不同画面使用 prompts 数组，数组每项生成一张并保持顺序。',
  permissions: ['network', 'fs:write'],
  tags: ['image'],
  source: 'native',
  gating: TOOL_GATE.image,
  schema: {
    type: 'object', properties: {
      prompt: { type: 'string', description: '单张图片提示词；使用 prompts 时可省略。' },
      prompts: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', minLength: 1 },
        description: '多张不同图片的完整提示词列表。每项独立生成一张，公共参考图会自动共享。',
      },
      aspectRatio: { type: 'string', enum: ['自动', '1:1', '4:5', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
      count: { type: 'integer', minimum: 1, maximum: 8 },
      modelId: { type: 'string', description: 'Use the exact modelId from the available image model list only when the user explicitly requests a model; omit it for automatic selection.' },
    },
    anyOf: [{ required: ['prompt'] }, { required: ['prompts'] }],
  },
});

export const imageEditTool = defineTool({
  id: nativeToolId('image_edit'),
  risk: 'external_side_effect',
  name: 'image_edit',
  description: '用户提供了参考图，并明确要求修改、重绘、换背景、保持主体、参考风格或基于图片继续生成时调用。参考图由系统自动传入。',
  permissions: ['network', 'fs:read', 'fs:write'],
  tags: ['image'],
  source: 'native',
  gating: TOOL_GATE.image,
  schema: {
    type: 'object', properties: {
      prompt: { type: 'string', description: '单张编辑提示词；使用 prompts 时可省略。' },
      prompts: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', minLength: 1 },
        description: '多张不同图片的编辑提示词列表。每项共享当前参考图。',
      },
      aspectRatio: { type: 'string', enum: ['自动', '1:1', '4:5', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
      count: { type: 'integer', minimum: 1, maximum: 8 },
      modelId: { type: 'string', description: 'Use the exact modelId from the available image model list only when the user explicitly requests a model; omit it for automatic selection.' },
    },
    anyOf: [{ required: ['prompt'] }, { required: ['prompts'] }],
  },
});
