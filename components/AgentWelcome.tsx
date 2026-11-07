import type { AgentOrbState } from '@/components/AgentOrb';
import AgentOrb from '@/components/AgentOrb';

type AgentWelcomeProps = {
  orbState: AgentOrbState;
  examples: string[];
  recentDraft?: { title: string; prompt: string } | null;
  onSelectExample: (example: string, label: string) => void;
};

const creativeFlows = [
  {
    key: 'film',
    title: '一键成片',
    detail: '脚本、分镜、画面、配音和字幕',
    prompt: '我想做一条完整的短视频。请先理解我的目标，给出脚本、分镜、画面、配音和字幕的执行计划，确认后再逐步生成。',
  },
  {
    key: 'visual',
    title: '产品视觉',
    detail: '海报、KV、社媒图和多种比例',
    prompt: '请帮我为一个产品建立一套视觉方案，先询问必要信息，再给出 3 个视觉方向，并推荐适合的图片模型和比例。',
  },
  {
    key: 'character',
    title: '角色一致性',
    detail: '角色设定、三视图和连续镜头',
    prompt: '请帮我建立一个可持续复用的角色设定，整理外观、服装、风格和禁止变化项，再生成角色设定图和后续镜头方案。',
  },
  {
    key: 'iterate',
    title: '继续创作',
    detail: '从已有素材生成变体或视频',
    prompt: '我想基于已有素材继续创作。请先判断适合做局部编辑、生成变体、扩图还是转视频，并只修改我指定的部分。',
  },
] as const;

/** Empty Agent conversation state; input state remains owned by Page. */
export default function AgentWelcome({ orbState, examples, recentDraft, onSelectExample }: AgentWelcomeProps) {
  return (
    <div className="agent-welcome">
      <AgentOrb state={orbState} label="" className="agent-welcome-orb" />
      <h1>把想法交给 SANMAO.AI</h1>
      <p>从目标开始，平台会帮你拆解创作步骤、选择合适的能力，并把结果继续推进到图片、视频、音频或画布。</p>
      <div className="creative-flow-grid" aria-label="创作路线">
        {creativeFlows.map((flow) => (
          <button
            key={flow.key}
            className="creative-flow-card"
            type="button"
            aria-label={`选择${flow.title}工作流`}
            onClick={() => onSelectExample(flow.prompt, flow.title)}
          >
            <span className="creative-flow-card-head">
              <strong>{flow.title}</strong>
              <span aria-hidden="true">→</span>
            </span>
            <small>{flow.detail}</small>
          </button>
        ))}
      </div>
      {recentDraft ? (
        <button
          type="button"
          className="agent-recent-draft"
          aria-label={`继续${recentDraft.title}`}
          onClick={() => onSelectExample(recentDraft.prompt, '继续最近创作')}
        >
          <span className="agent-recent-draft-copy">
            <strong>继续最近创作</strong>
            <small>{recentDraft.title}</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      ) : null}
      <div className="example-grid agent-example-fallback" aria-label="更多示例">
        {examples.slice(0, 2).map((example) => (
          <button key={example} type="button" onClick={() => onSelectExample(example, '示例提示词')}>{example}</button>
        ))}
      </div>
    </div>
  );
}
