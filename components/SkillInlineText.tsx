"use client";

import { splitSkillMessage } from "@/lib/skill-picker";

/** 聊天气泡里的用户文本：「用 X 技能：」渲染成色块 chip，其余保持纯文本。 */
export default function SkillInlineText({ text, className }: { text: string; className?: string }) {
  return (
    <p className={className}>
      {splitSkillMessage(text).map((part, index) =>
        part.kind === "skill" ? (
          <span key={`${index}-${part.name}`} className="skill-inline-mention" data-skill-name={part.name} title={`技能 · ${part.name}`}>
            <i aria-hidden="true">✦</i>
            <b>{part.name}</b>
          </span>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}
