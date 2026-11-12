import type { AgentIntentPreview as AgentIntentPreviewData } from '@/packages/contracts/planning';

const deliverableLabels: Record<AgentIntentPreviewData['deliverable'], string> = {
  IMAGE: '图片产物',
  TEXT: '文字产物',
  BOTH: '图片与文案',
  CLARIFY: '需要确认',
  OTHER: '通用对话',
};

const modeLabels: Record<AgentIntentPreviewData['mode'], string> = {
  execute: '执行指令',
  ask: '询问',
  discuss: '讨论',
  follow_up: '承接上文',
  unknown: '待进一步判断',
};

const routeLabels: Record<AgentIntentPreviewData['route'], string> = {
  chat: '对话',
  text: '文案',
  image: '图片',
  both: '图片与文案',
  word: 'Word 文档',
  excel: 'Excel 表格',
  ppt: '演示文稿',
  archive: '压缩包',
  file: '文件',
  browser: '浏览器',
  filesystem: '本地文件',
  web: '联网搜索',
  clarify: '澄清问题',
  mcp: 'MCP 能力',
  'native-web': '模型联网',
  skill: '技能',
};

const contextLabels: Record<AgentIntentPreviewData['contextNeed'], string> = {
  none: '无需历史上下文',
  recent: '参考近期对话',
  required: '需要完整相关上下文',
};

const confidenceLabels: Record<AgentIntentPreviewData['confidence'], string> = {
  high: '高',
  medium: '中',
  low: '低',
};

export default function AgentIntentPreview({ preview }: { preview: AgentIntentPreviewData }) {
  const deliverable = deliverableLabels[preview.deliverable];
  const mode = modeLabels[preview.mode];

  return (
    <details className="agent-intent-preview">
      <summary>
        <span>本轮理解</span>
        <strong>{deliverable}</strong>
        <span>{mode}</span>
      </summary>
      <div className="agent-intent-preview-details">
        <span><b>规划路径</b>{routeLabels[preview.route]}</span>
        <span><b>上下文</b>{contextLabels[preview.contextNeed]}</span>
        <span><b>判断置信度</b>{confidenceLabels[preview.confidence]}</span>
        <p><b>判断依据</b><span>{preview.reason}</span></p>
      </div>
    </details>
  );
}
