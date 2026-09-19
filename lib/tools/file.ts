import { defineTool, TOOL_GATE } from './registry';

export const fileGenerateTool = defineTool({
  name: 'file_generate',
  description: '只用于文本/代码类文件：Markdown、TXT、JSON、CSV、HTML、CSS、SVG、XML、YAML、代码。Word/Excel/PPT/ZIP 必须用专用工具，不允许把 Office 或 ZIP 内容编码成 base64 塞进来。',
  permissions: ['artifact:write'],
  tags: ['file'],
  source: 'native',
  gating: TOOL_GATE.file,
  schema: {
    type: 'object', properties: {
      files: {
        type: 'array', maximum: 8, items: {
          type: 'object', properties: {
            filename: { type: 'string' },
            mimeType: { type: 'string' },
            encoding: { type: 'string', enum: ['utf8', 'base64'] },
            content: { type: 'string' },
          }, required: ['filename', 'content'],
        },
      },
    }, required: ['files'],
  },
});
