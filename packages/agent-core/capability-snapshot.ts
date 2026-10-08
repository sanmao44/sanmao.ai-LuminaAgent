export type AgentCapabilitySnapshotInput = {
  currentModel: { displayName: string; providerName: string; nativeWebSearch: boolean };
  web: { mode: 'auto' | 'always' | 'off'; externalSearchConfigured: boolean };
  tools: { word: boolean; excel: boolean; ppt: boolean; archive: boolean; file: boolean };
  images: { generateModels: number; editModels: number };
};

function availability(value: boolean) {
  return value ? '可用' : '当前不可用';
}

/** Read-only Application projection used for capability answers. */
export function formatAgentCapabilitySnapshot(input: AgentCapabilitySnapshotInput) {
  const modeLabel = input.web.mode === 'auto' ? '智能按需' : input.web.mode === 'always' ? '始终允许' : '已关闭';
  return [
    '\n\n当前能力快照（由本轮运行时状态生成，仅用于回答“现在能不能/支持什么”，不要把它描述成已执行工具）：',
    `- 当前对话模型：${input.currentModel.displayName}（${input.currentModel.providerName}）`,
    `- 联网：${modeLabel}；模型原生联网${availability(input.currentModel.nativeWebSearch)}；外部搜索 API${availability(input.web.externalSearchConfigured)}`,
    `- Word 文档：${availability(input.tools.word)}；Excel 表格：${availability(input.tools.excel)}；PPT 演示文稿：${availability(input.tools.ppt)}；ZIP 压缩包：${availability(input.tools.archive)}；普通文件：${availability(input.tools.file)}`,
    `- 图片：生图模型 ${input.images.generateModels} 个，改图模型 ${input.images.editModels} 个`,
    '回答时应区分“能力已接入”和“本轮已经执行”：能力问题只说明支持范围与必要条件，不要调用生成、搜索或文件工具。',
  ].join('\n');
}
