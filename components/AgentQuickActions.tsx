import type { ComponentType } from 'react';
import OneTakeDurationPicker from '@/components/OneTakeDurationPicker';

type AgentQuickActionsProps = {
  hasReferences: boolean;
  referenceCount: number;
  referencesPending: boolean;
  hasInput: boolean;
  promptCanUndo: boolean;
  busy: boolean;
  selectionActive: boolean;
  promptOptimizing: boolean;
  skillMenuOpen: boolean;
  oneTakeDurationOpen: boolean;
  Icon: ComponentType<{ name: string; size?: number }>;
  SkillIcon: ComponentType<{ size?: number }>;
  onToggleSkillMenu: () => void;
  onReversePrompt: () => void;
  onOpenOneTake: () => void;
  onConfirmOneTake: (duration: number) => void;
  onCancelOneTake: () => void;
  onUndoPrompt: () => void;
  onOptimizePrompt: () => void;
};

/** Agent composer shortcuts; actions and state transitions remain page-owned. */
export default function AgentQuickActions({
  hasReferences,
  referenceCount,
  referencesPending,
  hasInput,
  promptCanUndo,
  busy,
  selectionActive,
  promptOptimizing,
  skillMenuOpen,
  oneTakeDurationOpen,
  Icon,
  SkillIcon,
  onToggleSkillMenu,
  onReversePrompt,
  onOpenOneTake,
  onConfirmOneTake,
  onCancelOneTake,
  onUndoPrompt,
  onOptimizePrompt,
}: AgentQuickActionsProps) {
  return (
    <>
      <button type="button" className={`agent-quick-button agent-skill-button ${skillMenuOpen ? 'active' : ''}`} disabled={busy} onClick={onToggleSkillMenu} title="选择技能：把某个技能指定给本轮任务" aria-label="选择技能">
        <SkillIcon size={14} />
        <span>技能</span>
      </button>
      {(hasReferences || hasInput) && (
        <div className="agent-quick-actions">
          {hasReferences && (
            <div className="one-take-duration-control">
              <button
                type="button"
                className={`agent-quick-button ${referenceCount > 1 ? 'one-take' : 'reverse'}`}
                disabled={busy || selectionActive || referencesPending}
                onClick={referenceCount > 1 ? onOpenOneTake : onReversePrompt}
                data-tooltip={referencesPending ? '参考图准备完成后才能生成' : referenceCount > 1 ? '设置时长并生成一镜到底视频 Prompt' : '根据已上传参考图反推提示词并自动提交'}
                aria-label={referencesPending ? '参考图准备完成后才能生成' : referenceCount > 1 ? '设置时长并生成一镜到底视频 Prompt' : '根据已上传参考图反推提示词并自动提交'}
              >
                <Icon name={referenceCount > 1 ? 'video' : 'image'} size={14} />
                {referenceCount > 1 ? '一镜到底' : '反推提示词'}
              </button>
              {referenceCount > 1 && <OneTakeDurationPicker open={oneTakeDurationOpen} busy={busy} onConfirm={onConfirmOneTake} onCancel={onCancelOneTake} />}
            </div>
          )}
          {promptCanUndo && (
            <button type="button" className="agent-quick-button prompt-undo" disabled={promptOptimizing || busy || selectionActive} onClick={onUndoPrompt} data-tooltip="撤回本次 AI 润色，恢复润色前的原文" aria-label="撤回本次 AI 润色">
              <span>撤回润色</span>
            </button>
          )}
          {hasInput && (
            <button type="button" className="agent-quick-button optimize" disabled={promptOptimizing || busy || selectionActive} onClick={onOptimizePrompt} data-tooltip="简单润色输入框中的文案，不会自动发送" aria-label="简单润色输入框中的文案，不会自动发送">
              <Icon name="agent" size={14} />
              {promptOptimizing ? 'AI 润色中…' : 'AI 润色'}
            </button>
          )}
        </div>
      )}
    </>
  );
}
