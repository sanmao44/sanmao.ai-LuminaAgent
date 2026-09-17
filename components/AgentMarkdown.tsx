"use client";

import { useMemo, type ReactNode } from "react";

/*
 * Agent 回复基本都是 Markdown：标题、粗体、列表、代码块。
 * 这里按块解析后渲染成 React 元素——不用 innerHTML，也不引第三方依赖，
 * 和 lib/share-conversation-layout.ts 给分享图排版用的块解析是同一个思路。
 */

export type AgentMarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "code"; language: string; code: string };

const FENCE_PATTERN = /^\s{0,3}```\s*([A-Za-z0-9+#._-]*)\s*$/;
const FENCE_END_PATTERN = /^\s{0,3}```\s*$/;
const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.*)$/;
const LIST_PATTERN = /^\s{0,3}(?:([-*+])|(\d{1,3})[.)])\s+(.*)$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
/* 行内只认最常见的四种：粗体、斜体、行内代码、链接。 */
const INLINE_PATTERN = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|\*[^*\n]+\*|_[^_\n]+_|\[[^\]\n]+\]\([^()\s]+\))/g;
/* 模型有时候会写 javascript: 之类的链接，只放行这几种协议。 */
const SAFE_LINK_PATTERN = /^(?:https?:\/\/|mailto:|\/)/i;

function startsBlock(line: string) {
  return (
    FENCE_PATTERN.test(line) ||
    HEADING_PATTERN.test(line) ||
    LIST_PATTERN.test(line) ||
    QUOTE_PATTERN.test(line)
  );
}

export function parseAgentMarkdown(value: string): AgentMarkdownBlock[] {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: AgentMarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = line.match(FENCE_PATTERN);
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_END_PATTERN.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      /* 截断的回复可能没有收尾的 ```，这时把剩下的都当代码。 */
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", language: fence[1] || "", code: code.join("\n") });
      continue;
    }
    const heading = line.match(HEADING_PATTERN);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    const list = line.match(LIST_PATTERN);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(LIST_PATTERN);
        if (!item) break;
        items.push(item[3].trim());
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    const quote = line.match(QUOTE_PATTERN);
    if (quote) {
      const rows: string[] = [];
      while (index < lines.length) {
        const row = lines[index].match(QUOTE_PATTERN);
        if (!row) break;
        rows.push(row[1].trim());
        index += 1;
      }
      blocks.push({ type: "quote", text: rows.join("\n") });
      continue;
    }
    /* 连续的普通行合成一段，段内换行交给 pre-wrap。 */
    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function inlineNodes(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    const token = match[0];
    const key = `inline-${start}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code className="canvas-agent-dock-inline-code" key={key}>
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      nodes.push(
        SAFE_LINK_PATTERN.test(href) ? (
          <a href={href} key={key} target="_blank" rel="noreferrer noopener">
            {label}
          </a>
        ) : (
          token
        ),
      );
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = start + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function AgentMarkdown({
  text,
  onCopyCode,
}: {
  text: string;
  onCopyCode?: (code: string) => void;
}) {
  const blocks = useMemo(() => parseAgentMarkdown(text), [text]);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`;
        if (block.type === "code")
          return (
            <div className="canvas-agent-dock-code" key={key}>
              <div className="canvas-agent-dock-code-head">
                <span>{block.language || "text"}</span>
                {onCopyCode ? (
                  <button type="button" onClick={() => onCopyCode(block.code)}>
                    复制
                  </button>
                ) : null}
              </div>
              <pre>
                <code>{block.code}</code>
              </pre>
            </div>
          );
        if (block.type === "heading")
          return (
            <p className="is-heading" data-level={Math.min(6, Math.max(1, block.level))} key={key}>
              {inlineNodes(block.text)}
            </p>
          );
        if (block.type === "quote") return <blockquote key={key}>{inlineNodes(block.text)}</blockquote>;
        if (block.type === "list") {
          const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineNodes(item)}</li>);
          return block.ordered ? (
            <ol className="is-list" key={key}>
              {items}
            </ol>
          ) : (
            <ul className="is-list" key={key}>
              {items}
            </ul>
          );
        }
        return <p key={key}>{inlineNodes(block.text)}</p>;
      })}
    </>
  );
}
