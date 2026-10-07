import type { AgentOrbState } from '@/components/AgentOrb';
import AgentOrb from '@/components/AgentOrb';

type AgentWelcomeProps = {
  orbState: AgentOrbState;
  examples: string[];
  onSelectExample: (example: string) => void;
};

/** Empty Agent conversation state; input state remains owned by Page. */
export default function AgentWelcome({ orbState, examples, onSelectExample }: AgentWelcomeProps) {
  return (
    <div className="agent-welcome">
      <AgentOrb state={orbState} label="" className="agent-welcome-orb" />
      <h1>把想法交给 SANMAO.AI</h1>
      <p>助手负责理解需求、优化提示词、选择你已添加的模型。你可以上传参考图让模型分析，也可以直接让助手生成可下载的 Markdown、CSV、JSON、HTML 和代码文件。</p>
      <div className="example-grid">
        {examples.map((example) => (
          <button key={example} onClick={() => onSelectExample(example)}>{example}</button>
        ))}
      </div>
    </div>
  );
}
