import { defineTool, TOOL_GATE } from './registry';

export const skillSearchTool = defineTool({
  name: 'skill_search',
  description: '按关键词检索用户已安装的技能（中英文关键词、中文别名都可以）。不确定有没有现成流程时先查一次。',
  permissions: ['fs:read'],
  tags: ['skill'],
  source: 'native',
  gating: TOOL_GATE.skills,
  schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
});

export const skillReadTool = defineTool({
  name: 'skill_read',
  description: '读取已启用技能的完整正文，或它附带的参考资料文件。技能索引里只有名称和简介，需要具体步骤时必须先读取。内容被截断时返回 truncated 与 nextOffset，带上 offset 继续读直到读完。返回的附件清单会标注类型（text / binary / script），脚本内容只作阅读参考，永远不要执行。',
  permissions: ['fs:read'],
  tags: ['skill'],
  source: 'native',
  gating: TOOL_GATE.skills,
  schema: { type: 'object', properties: { id: { type: 'string' }, file: { type: 'string', description: '可选，技能目录内的相对路径。' }, offset: { type: 'number', description: '可选，从第几个字符开始读，用于接着上一次被截断的位置继续读。' } }, required: ['id'] },
});

export const skillInstallTool = defineTool({
  name: 'skill_install',
  description: '安装技能：用户要求把某个链接、GitHub 仓库上的技能装进来，或你判断某套可复用流程值得沉淀成技能时调用。安装后需要用户在技能面板确认才会生效。',
  permissions: ['network', 'fs:write'],
  tags: ['skill'],
  source: 'native',
  gating: TOOL_GATE.skills,
  schema: {
    type: 'object', properties: {
      name: { type: 'string', description: '技能名称。' },
      description: { type: 'string', description: '一句话说明适用场景。' },
      body: { type: 'string', description: '技能正文（Markdown），写清目标、步骤和注意事项；从链接安装时留空。' },
      url: { type: 'string', description: '可选：GitHub 仓库或 SKILL.md 直链。仓库里有多个技能时安装会返回候选目录，需要先和用户确认装哪一个，再用带目录的链接重试。' },
      id: { type: 'string', description: '可选：英文技能标识。' },
      tags: { type: 'string', description: '可选：中文别名，逗号分隔（例如“报错,调试,修bug”）。安装英文技能时尽量补上，方便之后用中文检索到它。' },
    }, required: ['name'],
  },
});
