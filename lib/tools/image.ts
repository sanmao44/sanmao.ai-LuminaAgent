import { defineTool, TOOL_GATE } from './registry';

export const imageGenerateTool = defineTool({
  name: 'image_generate',
  description: '用户明确要求生成一张全新的图片时调用。',
  permissions: ['network', 'fs:write'],
  tags: ['image'],
  source: 'native',
  gating: TOOL_GATE.image,
  schema: {
    type: 'object', properties: {
      prompt: { type: 'string' },
      aspectRatio: { type: 'string', enum: ['自动', '1:1', '4:5', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
      count: { type: 'integer', minimum: 1, maximum: 8 },
      modelId: { type: 'string' },
    }, required: ['prompt'],
  },
});

export const imageEditTool = defineTool({
  name: 'image_edit',
  description: '用户提供了参考图，并明确要求修改、重绘、换背景、保持主体、参考风格或基于图片继续生成时调用。参考图由系统自动传入。',
  permissions: ['network', 'fs:read', 'fs:write'],
  tags: ['image'],
  source: 'native',
  gating: TOOL_GATE.image,
  schema: {
    type: 'object', properties: {
      prompt: { type: 'string' },
      aspectRatio: { type: 'string', enum: ['自动', '1:1', '4:5', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
      count: { type: 'integer', minimum: 1, maximum: 8 },
      modelId: { type: 'string' },
    }, required: ['prompt'],
  },
});
