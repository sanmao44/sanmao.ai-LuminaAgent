'use client';

import { useEffect, useMemo, useRef } from 'react';
import { filterSkills, type SkillPickerEntry } from '@/lib/skill-picker';

type AgentSkillMenuProps = {
  open: boolean;
  skills: readonly SkillPickerEntry[];
  query: string;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onSelect: (skill: SkillPickerEntry) => void;
  onClose: () => void;
  emptyHint?: string;
  ignorePointerSelector?: string;
};

export default function AgentSkillMenu({ open, skills, query, activeIndex, onActiveIndexChange, onSelect, onClose, emptyHint, ignorePointerSelector = '.agent-composer-wrap, .canvas-agent-dock-composer' }: AgentSkillMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const visible = useMemo(() => filterSkills(skills, query), [skills, query]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      // 点击输入区内部（按钮、输入框）不关闭，避免和「技能」按钮的开关互相打架。
      if (target instanceof Element && ignorePointerSelector && target.closest(ignorePointerSelector)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, ignorePointerSelector]);

  if (!open) return null;

  return (
    <div ref={rootRef} className="reference-mention-menu agent-mention-menu agent-skill-menu" role="listbox" aria-label="选择技能">
      <div className="reference-mention-title">{query ? `技能 · 匹配「${query}」` : '技能 · 点一下指定本轮使用'}</div>
      {visible.length ? visible.map((skill, index) => (
        <button
          type="button"
          role="option"
          key={skill.id}
          aria-selected={index === activeIndex}
          className={index === activeIndex ? 'active' : ''}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActiveIndexChange(index)}
          onClick={() => onSelect(skill)}
        >
          <span className="agent-skill-menu-mark" aria-hidden="true">✦</span>
          <span className="agent-skill-menu-copy">
            <strong>{skill.name}</strong>
            <small>{skill.description || '（无简介）'}</small>
          </span>
        </button>
      )) : (
        <p className="agent-skill-menu-empty">
          {skills.length ? `没有匹配「${query}」的技能` : emptyHint || '还没有启用中的技能。点聊天区左上角的 ☆ 按钮可以安装或启用。'}
        </p>
      )}
      <p className="agent-skill-menu-tip">助手平时会自己挑技能，这里用来精确指定；输入 / 也能随时呼出。</p>
    </div>
  );
}
