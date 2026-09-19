/**
 * 工具执行类别的唯一来源：注册表标签 → route.ts 里的执行分支。
 *
 * 以前 route.ts 用「工具名等于 web_search 就联网、等于 file_generate 就写文件」来判断分派，加一个工具
 * 就要回去改路由，名字对不上还会静默落空。现在改成按注册表标签推导类别：新工具只要在 lib/tools/*.ts
 * 里声明标签，就会自动落到对应分支；推导不出类别的调用不执行。权限判断不在这里，route 在分派前统一
 * 走 lib/tools/policy.ts。
 */
import type { ToolDefinition, ToolTag } from './registry';

export type ToolExecutionKind = 'web' | 'file' | 'artifact' | 'image' | 'skill' | 'mcp' | 'mcp-manage';

/** 一个工具只归入第一类命中的标签；archive_generate 带 artifact + archive，复用 artifact 分支。 */
const KIND_BY_TAG: ReadonlyArray<readonly [ToolTag, ToolExecutionKind]> = [
  ['web', 'web'],
  ['file', 'file'],
  ['artifact', 'artifact'],
  ['image', 'image'],
  ['skill', 'skill'],
  ['mcp', 'mcp'],
  ['mcp-admin', 'mcp-manage'],
];

/** 来源比标签更准：MCP 这类运行时工具永远归入自己的分支。 */
export function kindForTool(definition: Pick<ToolDefinition, 'tags' | 'source'>): ToolExecutionKind | null {
  if (definition.source === 'mcp') return 'mcp';
  for (const [tag, kind] of KIND_BY_TAG) {
    if (definition.tags.includes(tag)) return kind;
  }
  return null;
}
