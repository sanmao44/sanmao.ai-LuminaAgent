"use client";

import { Fragment, useState, type ComponentType, type ElementType, type ReactNode } from "react";
import AssistantCodeBlock from "./AssistantCodeBlock";
import { isChatDirectionHeading } from "@/lib/agent-web";

type DirectionPicker = { kind: "chat" | "image"; directions: string[]; disabled?: boolean; onSelect?: (direction: string) => void };
type AssistantMarkdownProps = { content: string; Icon: ComponentType<{ name: string; size?: number }>; onNotify: (message: string) => void; directionPicker?: DirectionPicker };

function renderInlineMarkdown(text: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*|_[^_]+_)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) nodes.push(<strong key={`${match.index}-b`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) nodes.push(<code className="inline-code" key={`${match.index}-c`}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      nodes.push(link ? <a href={link[2]} target="_blank" rel="noreferrer" key={`${match.index}-a`}>{link[1]}</a> : token);
    } else nodes.push(<em key={`${match.index}-i`}>{token.slice(1, -1)}</em>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function MarkdownBlocks({ lines }: { lines: string[] }) {
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => { if (!paragraph.length) return; blocks.push(<p key={`p-${blocks.length}`}>{paragraph.map((line, index) => <Fragment key={index}>{index > 0 && <br />}{renderInlineMarkdown(line)}</Fragment>)}</p>); paragraph = []; };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { flushParagraph(); index += 1; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); const Tag = `h${heading[1].length}` as ElementType; blocks.push(<Tag key={`h-${index}`}>{renderInlineMarkdown(heading[2])}</Tag>); index += 1; continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); const listItems: string[] = []; const orderedList = Boolean(ordered);
      while (index < lines.length) { const item = lines[index].match(orderedList ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/); if (!item) break; listItems.push(item[1]); index += 1; }
      const ListTag = (orderedList ? "ol" : "ul") as ElementType; blocks.push(<ListTag key={`list-${index}`}>{listItems.map((item, itemIndex) => <li key={itemIndex}>{renderInlineMarkdown(item)}</li>)}</ListTag>); continue;
    }
    if (/^>\s?/.test(line)) { flushParagraph(); const quote: string[] = []; while (index < lines.length && /^>\s?/.test(lines[index])) { quote.push(lines[index].replace(/^>\s?/, "")); index += 1; } blocks.push(<blockquote key={`quote-${index}`}>{quote.map((item, quoteIndex) => <Fragment key={quoteIndex}>{quoteIndex > 0 && <br />}{renderInlineMarkdown(item)}</Fragment>)}</blockquote>); continue; }
    paragraph.push(line); index += 1;
  }
  flushParagraph();
  return <>{blocks}</>;
}

function DirectionPicker({ picker }: { picker: DirectionPicker }) {
  if (!picker.directions.length) return null;
  return <div className="agent-direction-options">{picker.directions.map((direction, index) => <button type="button" className="agent-direction-option" disabled={picker.disabled} title={direction} aria-label={`第${index + 1}项：${direction}`} onClick={() => picker.onSelect?.(direction)} key={`${index}-${direction}`}><span className="agent-direction-option-number">{index + 1}</span><span className="agent-direction-option-copy">{direction}</span><span className="agent-direction-option-arrow" aria-hidden="true">→</span></button>)}</div>;
}

export default function AssistantMarkdown({ content, Icon, onNotify, directionPicker }: AssistantMarkdownProps) {
  const shouldCollapse = content.length > 2400 || content.split(/\n/).length > 36;
  const [expanded, setExpanded] = useState(false);
  const lines = content.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let normalLines: string[] = [];
  let codeLanguage: string | null = null;
  let codeLines: string[] = [];
  const flushNormal = () => { if (normalLines.length) { blocks.push(<MarkdownBlocks lines={normalLines} key={`markdown-${blocks.length}`} />); normalLines = []; } };
  let directionInserted = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const isDirectionHeading = directionPicker && directionPicker.directions.length > 0 && (directionPicker.kind === "chat" ? isChatDirectionHeading(line) : /(?:下一版|下个版本|后续).{0,24}(?:可尝试|尝试方向|调整方向|方向)/i.test(line));
    if (isDirectionHeading && !directionInserted) {
      flushNormal(); blocks.push(<section className="agent-direction-section" key={`directions-${blocks.length}`}><h3>{line.replace(/^\s*#{1,6}\s*/, "").trim()}</h3><DirectionPicker picker={directionPicker} /></section>); directionInserted = true;
      lineIndex += 1; while (lineIndex < lines.length) { if (!lines[lineIndex].trim() || /^\s*(?:(?:[-*+·])\s*|\d+[.)、]\s*)/.test(lines[lineIndex])) { lineIndex += 1; continue; } break; } lineIndex -= 1; continue;
    }
    const fence = line.match(/^\s*```\s*([^\s]*)\s*$/);
    if (fence) { if (codeLanguage === null) { flushNormal(); codeLanguage = fence[1] || "text"; codeLines = []; } else { blocks.push(<AssistantCodeBlock language={codeLanguage} code={codeLines.join("\n")} Icon={Icon} onNotify={onNotify} key={`code-${blocks.length}`} />); codeLanguage = null; codeLines = []; } }
    else if (codeLanguage !== null) codeLines.push(line); else normalLines.push(line);
  }
  if (codeLanguage !== null) blocks.push(<AssistantCodeBlock language={codeLanguage} code={codeLines.join("\n")} Icon={Icon} onNotify={onNotify} key={`code-${blocks.length}`} />);
  flushNormal();
  if (directionPicker?.kind === "chat" && !directionInserted && directionPicker.directions.length > 0) blocks.push(<section className="agent-direction-section chat-direction-section" key={`directions-${blocks.length}`}><h3>你还可以继续</h3><DirectionPicker picker={directionPicker} /></section>);
  return <div className={`assistant-markdown ${shouldCollapse && !expanded ? "is-collapsed" : ""}`}><div className="assistant-markdown-content">{blocks}</div>{shouldCollapse && <button type="button" className="assistant-markdown-toggle" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>{expanded ? "收起长内容" : "展开完整内容"}</button>}</div>;
}
