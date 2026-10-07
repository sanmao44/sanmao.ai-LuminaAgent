"use client";

import { useState, type ComponentType } from "react";

type AssistantCodeBlockProps = {
  language: string;
  code: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onNotify: (message: string) => void;
};

function codeDownloadExtension(language: string) {
  if (["js", "javascript"].includes(language)) return "js";
  if (language === "jsx") return "jsx";
  if (["ts", "typescript"].includes(language)) return "ts";
  if (language === "tsx") return "tsx";
  if (language === "json") return "json";
  if (language === "css") return "css";
  if (["html", "htm"].includes(language)) return "html";
  if (language === "xml") return "xml";
  if (language === "svg") return "svg";
  if (["py", "python"].includes(language)) return "py";
  if (["yaml", "yml"].includes(language)) return "yml";
  if (["sh", "bash", "shell"].includes(language)) return "sh";
  if (["ps1", "powershell"].includes(language)) return "ps1";
  if (["md", "markdown"].includes(language)) return "md";
  return "txt";
}

function renderCodeLine(text: string, language: string) {
  if (!["js", "jsx", "ts", "tsx", "javascript", "typescript", "json", "css", "html", "htm", "xml", "svg"].includes(language)) return [text];
  const pattern = /(\/\/.*$|\/\*[\s\S]*?\*\/|<!--.*?-->|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|if|else|for|while|return|function|true|false|null|undefined|new|class|this|import|from|export|async|await|try|catch|throw)\b|\b\d+(?:\.\d+)?\b)/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const className = /^(\/\/|\/\*|<!--)/.test(token) ? "code-token-comment" : /^("|'|`)/.test(token) ? "code-token-string" : /^\d/.test(token) ? "code-token-number" : "code-token-keyword";
    nodes.push(<span className={className} key={`${match.index}-${className}`}>{token}</span>);
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function AssistantCodeBlock({ language, code, Icon, onNotify }: AssistantCodeBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const normalizedLanguage = language.trim().toLowerCase() || "text";
  const lines = code.replace(/\n$/, "").split("\n");
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(code); onNotify("代码已复制"); } catch { onNotify("复制失败"); }
  };
  const downloadCode = () => {
    try {
      const url = URL.createObjectURL(new Blob([code], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `sanmao-code.${codeDownloadExtension(normalizedLanguage)}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      onNotify(`代码已下载：${anchor.download}`);
    } catch { onNotify("代码下载失败"); }
  };
  const runCode = () => {
    if (!["html", "htm", "svg", "xml"].includes(normalizedLanguage)) return onNotify("当前语言仅支持复制，不能在浏览器中直接运行");
    const type = normalizedLanguage === "svg" ? "image/svg+xml" : "text/html";
    const url = URL.createObjectURL(new Blob([code], { type }));
    const tab = window.open(url, "_blank", "noopener,noreferrer");
    if (!tab) onNotify("浏览器拦截了预览窗口，请允许弹窗");
    window.setTimeout(() => URL.revokeObjectURL(url), 20000);
  };
  const canRun = ["html", "htm", "svg", "xml"].includes(normalizedLanguage);
  return <div className={`assistant-code-block ${expanded ? "expanded" : ""}`}>
    <div className="assistant-code-toolbar"><span className="assistant-code-language">{normalizedLanguage}</span><div className="assistant-code-actions">
      {canRun && <button type="button" onClick={runCode}><span className="code-run-symbol">▶</span>运行</button>}
      <button type="button" onClick={downloadCode}><Icon name="download" size={13} />下载</button>
      <button type="button" onClick={() => void copyCode()}><Icon name="copy" size={13} />复制</button>
      <button type="button" onClick={() => setExpanded((value) => !value)}><Icon name={expanded ? "close" : "full"} size={13} />{expanded ? "关闭" : "全屏"}</button>
    </div></div>
    <pre><code>{lines.map((line, index) => <span className="assistant-code-line" key={index}><span className="assistant-code-number">{index + 1}</span><span className="assistant-code-text">{renderCodeLine(line || " ", normalizedLanguage)}</span></span>)}</code></pre>
  </div>;
}
