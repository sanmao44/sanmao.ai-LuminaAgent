import { defineTool, TOOL_GATE } from './registry';

export const webSearchTool = defineTool({
  name: 'web_search',
  description: '当用户的问题需要实时、最新、外部事实、当前价格/版本/政策/新闻、资料来源或事实核验时调用。不要要求用户输入固定关键词；由你根据问题判断是否真的需要联网。普通闲聊、创作、代码推理或已有上下文足够回答时不要调用。用户明确说不要联网时不要调用。',
  permissions: ['network'],
  tags: ['web'],
  source: 'native',
  gating: TOOL_GATE.never,
  acceptUnlisted: true,
  schema: {
    type: 'object', properties: {
      query: { type: 'string', description: '适合搜索引擎的简洁中文检索式，包含主题、时间范围和必要限定。' },
    }, required: ['query'],
  },
});
