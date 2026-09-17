"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import SelectMenu from "@/components/SelectMenu";
import SkillManager from "@/components/SkillManager";
import SkillIcon from "@/components/SkillIcon";
import AgentSkillMenu from "@/components/AgentSkillMenu";
import { filterSkills, skillMessageValue, skillSlashQuery, type SkillPickerEntry } from "@/lib/skill-picker";
import {
  agentModelOptions,
  type AgentWebMode,
} from "@/lib/creation/settings";
import { generateCanvasAgent } from "@/lib/canvas/api";
import {
  CANVAS_AGENT_DOCK_MAX_REFERENCES,
  canvasAgentDockAcceptsImages,
  composeCanvasAgentDockMessage,
  type CanvasAgentDockChip,
  type CanvasAgentDockReference,
  type CanvasAgentDockStatus,
} from "@/lib/canvas/agent-dock";
import type { PublicState } from "@/lib/types";

export const CANVAS_AGENT_DOCK_OPEN_KEY = "sanmao.canvas.agentdock.open.v1";
export const CANVAS_AGENT_DOCK_SESSION_KEY = "sanmao.canvas.agentdock.session.v1";

export type CanvasAgentDockMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  model?: string;
  images?: Array<{ url: string; revisedPrompt?: string }>;
  skills?: Array<{ id: string; name: string }>;
  error?: string;
  applied?: boolean;
};

type CanvasAgentDockSession = {
  model: string;
  webMode: AgentWebMode;
  autoApply: boolean;
  messages: CanvasAgentDockMessage[];
};

type Props = {
  open: boolean;
  onToggle: (open: boolean) => void;
  status: CanvasAgentDockStatus;
  chips: CanvasAgentDockChip[];
  references: CanvasAgentDockReference[];
  contextBlock: string;
  runtime: PublicState | null;
  onFocusNodes: (ids: string[]) => void;
  onApplyImages: (
    images: Array<{ url: string; revisedPrompt?: string }>,
    meta: { prompt: string; model?: string },
  ) => void;
  onApplyText: (text: string, meta: { prompt: string }) => void;
  onCreateAgentNode: (text: string) => void;
  onUseAsImagePrompt: (text: string) => void;
  onUseAsVideoPrompt: (text: string) => void;
  notify: (message: string, kind?: "ok" | "error") => void;
};

const MESSAGE_LIMIT = 40;
const EMPTY_SAMPLES = [
  "这几个节点的问题在哪？",
  "帮我写一版更细的提示词",
  "选中这张图，继续做 16:9 的版本",
];
const WEB_MODE_LABELS: Record<AgentWebMode, string> = {
  off: "不联网",
  auto: "按需联网",
  always: "总是联网",
};

function createId() {
  return `dock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/* 选段操作只认单条消息：跨气泡的选区没有对应的节点语义。 */
function messageElementOf(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement || null;
  return element?.closest<HTMLElement>(".canvas-agent-dock-message") || null;
}

function readSession(): CanvasAgentDockSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CANVAS_AGENT_DOCK_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CanvasAgentDockSession>;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((message) => message && (message.role === "user" || message.role === "assistant"))
          .map((message) => ({
            id: String(message.id || createId()),
            role: message.role,
            content: String(message.content || ""),
            ...(message.model ? { model: String(message.model) } : {}),
            ...(Array.isArray(message.images) && message.images.length
              ? { images: message.images.map((image) => ({ url: String(image.url || ""), ...(image.revisedPrompt ? { revisedPrompt: String(image.revisedPrompt) } : {}) })) }
              : {}),
            ...(Array.isArray(message.skills) && message.skills.length
              ? { skills: message.skills.map((skill) => ({ id: String(skill.id || ""), name: String(skill.name || "") })) }
              : {}),
            ...(message.applied ? { applied: true } : {}),
          }))
          .filter((message) => message.content || message.images?.length)
      : [];
    return {
      model: typeof parsed.model === "string" && parsed.model ? parsed.model : "auto",
      webMode: parsed.webMode === "auto" || parsed.webMode === "always" ? parsed.webMode : "off",
      autoApply: parsed.autoApply !== false,
      messages,
    };
  } catch {
    return null;
  }
}

export default function CanvasAgentDock({
  open,
  onToggle,
  status,
  chips,
  references,
  contextBlock,
  runtime,
  onFocusNodes,
  onApplyImages,
  onApplyText,
  onCreateAgentNode,
  onUseAsImagePrompt,
  onUseAsVideoPrompt,
  notify,
}: Props) {
  const [messages, setMessages] = useState<CanvasAgentDockMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [model, setModel] = useState("auto");
  const [webMode, setWebMode] = useState<AgentWebMode>("off");
  const [autoApply, setAutoApply] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [skillActive, setSkillActive] = useState(0);
  const [skills, setSkills] = useState<SkillPickerEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const skillMenuFromSlashRef = useRef(false);

  useEffect(() => {
    const stored = readSession();
    if (stored) {
      setMessages(stored.messages);
      setModel(stored.model);
      setWebMode(stored.webMode);
      setAutoApply(stored.autoApply);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Persist only after hydration has been committed, otherwise the mount
    // pass would overwrite the stored session with the empty initial state.
    if (!hydrated || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        CANVAS_AGENT_DOCK_SESSION_KEY,
        JSON.stringify({ model, webMode, autoApply, messages: messages.slice(-MESSAGE_LIMIT) }),
      );
    } catch {
      /* session persistence is best effort */
    }
  }, [hydrated, messages, model, webMode, autoApply]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, streamText, open]);

  useLayoutEffect(() => {
    // Grow upward with the text and only scroll inside the field once it hits its cap.
    const field = textareaRef.current;
    if (!field) return;
    const styles = window.getComputedStyle(field);
    const minHeight = parseFloat(styles.minHeight) || 56;
    const maxHeight = parseFloat(styles.maxHeight) || 190;
    field.style.height = "auto";
    const contentHeight = field.scrollHeight;
    field.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    field.style.overflowX = "hidden";
    field.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [input, open]);

  const modelOptions = useMemo(() => {
    const models = agentModelOptions(runtime);
    return [
      { value: "auto", label: "自动选择", description: "按画布设置挑一个可用模型" },
      ...models.map((item) => ({
        value: item.id,
        label: item.displayName || item.id,
        description: item.providerName || item.providerId || "",
      })),
    ];
  }, [runtime]);

  const quickActions = useMemo(
    () => [
      { label: "总结选中", prompt: "用 5 条以内的要点总结我选中的这些节点，并指出可继续的方向。" },
      { label: "写提示词", prompt: "基于选中的节点，给我 3 条可直接用于图片生成的中文提示词。" },
      { label: "排查失败", prompt: "如果画布上有失败或卡住的节点，说明原因并给出具体修复步骤。" },
      { label: "下一步建议", prompt: "结合当前选中的节点和它们的关系，告诉我下一步最值得做的 3 件事。" },
    ],
    [],
  );

  const refreshSkills = useCallback(async () => {
    try {
      const response = await fetch("/api/skills", { cache: "no-store" });
      const data = await response.json();
      setSkills(Array.isArray(data?.skills) ? data.skills.filter((skill: SkillPickerEntry) => skill && skill.enabled) : []);
    } catch {
      /* 拉取失败时保留上一次的技能列表 */
    }
  }, []);

  const closeSkillMenu = useCallback(() => {
    skillMenuFromSlashRef.current = false;
    setSkillMenuOpen(false);
    setSkillQuery("");
  }, []);

  const openSkillMenu = useCallback(
    (query: string) => {
      setSkillQuery(query || "");
      setSkillActive(0);
      setSkillMenuOpen(true);
      void refreshSkills();
    },
    [refreshSkills],
  );

  const applySkill = useCallback(
    (skill: SkillPickerEntry) => {
      setInput((value) => skillMessageValue(value, skill.name));
      closeSkillMenu();
      window.setTimeout(() => {
        const node = textareaRef.current;
        if (!node) return;
        node.focus();
        const end = node.value.length;
        try {
          node.setSelectionRange(end, end);
        } catch {
          /* 隐藏状态下部分浏览器会拒绝设置选区 */
        }
      }, 0);
    },
    [closeSkillMenu],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort(new DOMException("已停止", "AbortError"));
    abortRef.current = null;
    setBusy(false);
  }, []);

  const send = useCallback(
    async (raw?: string) => {
      const text = String(raw ?? input).trim();
      if (!text) {
        notify("先输入要问 Agent 的内容。", "error");
        return;
      }
      if (busy) return;
      closeSkillMenu();
      const userMessage: CanvasAgentDockMessage = { id: createId(), role: "user", content: text };
      const history = [...messages, userMessage];
      setMessages(history);
      setInput("");
      setStreamText("");
      setBusy(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const outbound = history.map((message, index) => ({
        role: message.role,
        content:
          index === history.length - 1
            ? composeCanvasAgentDockMessage(message.content, contextBlock)
            : message.content,
      }));
      try {
        const response = await generateCanvasAgent(
          {
            messages: outbound,
            model,
            webMode,
            // 画布上下文只给模型看，意图判断必须用用户自己那句话。
            intentText: text,
            references: references.slice(0, CANVAS_AGENT_DOCK_MAX_REFERENCES),
            signal: controller.signal,
          },
          (event) => {
            if (event.type === "delta" && event.text) setStreamText((value) => value + String(event.text));
          },
        );
        const content = String(response.message || "").trim() || "（Agent 没有返回文本内容）";
        const images = canvasAgentDockAcceptsImages(response.deliverable)
          ? (response.images || []).map((image) => ({
              url: String(image.url || ""),
              ...(image.revisedPrompt ? { revisedPrompt: String(image.revisedPrompt) } : {}),
            }))
          : [];
        setMessages((value) => [
          ...value,
          {
            id: createId(),
            role: "assistant",
            content,
            model: response.model,
            ...(images.length ? { images } : {}),
            ...(response.skills?.length
              ? { skills: response.skills.map((skill) => ({ id: String(skill.id || ""), name: String(skill.name || "") })) }
              : {}),
          },
        ]);
        if (images.length && autoApply) {
          onApplyImages(images, { prompt: text, model: response.model });
          setMessages((value) => value.map((message, index) => (index === value.length - 1 ? { ...message, applied: true } : message)));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent 请求失败";
        if (message.includes("已停止") || (error instanceof DOMException && error.name === "AbortError")) {
          setMessages((value) => [...value, { id: createId(), role: "assistant", content: "已停止这一轮回答。" }]);
        } else {
          setMessages((value) => [...value, { id: createId(), role: "assistant", content: `请求失败：${message}`, error: message }]);
          notify(message, "error");
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
        setStreamText("");
      }
    },
    [autoApply, busy, closeSkillMenu, contextBlock, input, messages, model, notify, onApplyImages, references, webMode],
  );

  const cycleWebMode = useCallback(() => {
    setWebMode((value) => (value === "off" ? "auto" : value === "auto" ? "always" : "off"));
  }, []);

  const clearSession = useCallback(() => {
    stop();
    setMessages([]);
    setStreamText("");
    notify("已开始新的 Agent 对话");
  }, [notify, stop]);

  const copyMessage = useCallback(
    (content: string) => {
      void navigator.clipboard?.writeText(content).then(
        () => notify("已复制"),
        () => notify("复制失败", "error"),
      );
    },
    [notify],
  );

  const [selection, setSelection] = useState<{
    text: string;
    x: number;
    y: number;
    placement: "above" | "below";
  } | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
    if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  }, []);

  /* 面板里的回复用和节点文本一样的选中工具栏：选段后能直接复制、建节点、转图片/转视频。 */
  const updateSelection = useCallback(() => {
    const log = logRef.current;
    const dock = log?.closest(".canvas-agent-dock") || null;
    const current = typeof window === "undefined" ? null : window.getSelection();
    if (
      !log ||
      !dock ||
      !current ||
      current.isCollapsed ||
      !current.rangeCount ||
      !current.anchorNode ||
      !current.focusNode ||
      !log.contains(current.anchorNode) ||
      !log.contains(current.focusNode)
    ) {
      setSelection(null);
      return;
    }
    const anchorMessage = messageElementOf(current.anchorNode);
    if (!anchorMessage || anchorMessage !== messageElementOf(current.focusNode)) {
      setSelection(null);
      return;
    }
    const selectedText = current.toString().trim();
    const rect = current.getRangeAt(0).getBoundingClientRect();
    if (!selectedText || (!rect.width && !rect.height)) {
      setSelection(null);
      return;
    }
    /* 工具栏必须留在面板的 DOM 里：画布用它判断这一按是不是 UI 覆盖层，
       否则会被当成平移起手并抢走 pointer capture，按钮收不到 click。 */
    const dockRect = dock.getBoundingClientRect();
    const toolbarWidth = Math.min(420, Math.max(260, dockRect.width - 16));
    const halfWidth = toolbarWidth / 2;
    const center = rect.left + rect.width / 2 - dockRect.left;
    const x = Math.min(dockRect.width - halfWidth - 8, Math.max(halfWidth + 8, center));
    const top = rect.top - dockRect.top;
    const bottom = rect.bottom - dockRect.top;
    const showBelow = top < 48;
    setSelection({
      text: selectedText,
      x,
      y: showBelow ? bottom + 8 : top - 8,
      placement: showBelow ? "below" : "above",
    });
  }, []);

  useEffect(() => {
    if (!selection) return;
    const log = logRef.current;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".canvas-text-selection-toolbar")) return;
      if (!log?.contains(target)) setSelection(null);
    };
    const handleViewportChange = () => setSelection(null);
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    log?.addEventListener("scroll", handleViewportChange);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      log?.removeEventListener("scroll", handleViewportChange);
    };
  }, [selection]);

  const copySelection = useCallback(() => {
    const value = selection?.text;
    if (!value) return;
    clearSelection();
    void navigator.clipboard?.writeText(value).then(
      () => notify("已复制选中的文本"),
      () => notify("复制失败，请检查浏览器剪贴板权限", "error"),
    );
  }, [clearSelection, notify, selection]);

  const runSelectionAction = useCallback(
    (action: (value: string) => void) => {
      const value = selection?.text;
      if (!value) return;
      clearSelection();
      action(value);
    },
    [clearSelection, selection],
  );

  if (!open)
    return (
      <button
        type="button"
        className="canvas-agent-dock-rail"
        onClick={() => onToggle(true)}
        title="展开 Agent 助手"
        aria-label="展开 Agent 助手"
      >
        <span aria-hidden="true">✦</span>
        <em>Agent</em>
        {status.running + status.queued > 0 && <b>{status.running + status.queued}</b>}
      </button>
    );

  return (
    <aside className="canvas-agent-dock" aria-label="画布 Agent 助手">
      <header className="canvas-agent-dock-head">
        <div className="canvas-agent-dock-title">
          <span aria-hidden="true">✦</span>
          <div>
            <b>Agent 助手</b>
            <small>
              {chips.length ? `已选中 ${chips.length} 个节点` : "未选中节点 · 选中后提问更准"}
              {status.running + status.queued > 0 ? ` · ${status.running + status.queued} 个在跑` : ""}
              {status.failed > 0 ? ` · ${status.failed} 个失败` : ""}
            </small>
          </div>
        </div>
        <div className="canvas-agent-dock-head-actions">
          <SkillManager disabled={busy} icon={<SkillIcon size={14} />} />
          <button type="button" onClick={clearSession} title="新建对话" aria-label="新建对话">
            ＋
          </button>
          <button type="button" onClick={() => onToggle(false)} title="收起 Agent 助手" aria-label="收起 Agent 助手">
            —
          </button>
        </div>
      </header>
      <div className="canvas-agent-dock-context">
        {chips.length ? (
          chips.map((chip) => (
            <button
              type="button"
              key={chip.id}
              className="canvas-agent-dock-chip"
              onClick={() => onFocusNodes([chip.id])}
              title={`定位到${chip.label}`}
            >
              {chip.thumb ? <img src={chip.thumb} alt="" /> : <i aria-hidden="true">{chip.kind === "text" ? "T" : "▣"}</i>}
              <span>{chip.label}</span>
            </button>
          ))
        ) : (
          <small>在画布上选中节点后，这里会显示它们，并把节点信息一起发给 Agent。</small>
        )}
      </div>
      <div
        className="canvas-agent-dock-log"
        ref={logRef}
        role="log"
        aria-live="polite"
        onMouseUp={updateSelection}
        onKeyUp={updateSelection}
        onTouchEnd={updateSelection}
      >
        {messages.length === 0 && !busy && (
          <div className="canvas-agent-dock-empty">
            <b>可以这样问</b>
            {EMPTY_SAMPLES.map((sample) => (
              <button key={sample} type="button" onClick={() => setInput(sample)}>
                {sample}
              </button>
            ))}
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={`canvas-agent-dock-message ${message.role} ${message.error ? "is-error" : ""} ${message.role === "user" && message.images?.length ? "has-media" : ""}`}
          >
            {message.role === "assistant" ? (
              <div className="canvas-agent-dock-role">
                <b>✦ Agent</b>
                {message.model ? <small>{message.model}</small> : null}
              </div>
            ) : null}
            {message.skills?.length ? (
              <div className="canvas-agent-dock-skills">
                {message.skills.map((skill) => (
                  <span key={skill.id || skill.name}>技能 · {skill.name}</span>
                ))}
              </div>
            ) : null}
            <p>{message.content}</p>
            {message.images?.length ? (
              <div className="canvas-agent-dock-media">
                {message.images.map((image, index) => (
                  <img key={`${message.id}-${index}`} src={image.url} alt={image.revisedPrompt || "Agent 图片"} />
                ))}
              </div>
            ) : null}
            <div className="canvas-agent-dock-message-tools">
              {message.role === "assistant" && !message.error ? (
                <>
                  <button type="button" onClick={() => onApplyText(message.content, { prompt: "Agent 回复" })}>
                    存为节点
                  </button>
                  <button type="button" onClick={() => copyMessage(message.content)}>
                    复制
                  </button>
                </>
              ) : null}
              {message.role === "user" ? (
                <button type="button" onClick={() => copyMessage(message.content)}>
                  复制
                </button>
              ) : null}
              {message.images?.length ? (
                <button
                  type="button"
                  disabled={message.applied}
                  onClick={() => {
                    onApplyImages(message.images || [], { prompt: "Agent 图片", model: message.model });
                    setMessages((value) =>
                      value.map((item) => (item.id === message.id ? { ...item, applied: true } : item)),
                    );
                  }}
                >
                  {message.applied ? "已加入画布" : "加入画布"}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="canvas-agent-dock-message assistant is-streaming">
            <p>{streamText || "正在思考…"}</p>
          </div>
        ) : null}
      </div>
      {selection ? (
        <div
          className={`canvas-text-selection-toolbar canvas-agent-dock-selection-toolbar ${selection.placement}`}
          style={{ left: selection.x, top: selection.y }}
          role="toolbar"
          aria-label="选中文本操作"
          onMouseDown={(event) => event.preventDefault()}
          onTouchStart={(event) => event.preventDefault()}
        >
          <span>{selection.text.length.toLocaleString()} 字</span>
          <button type="button" onClick={copySelection}>
            复制选段
          </button>
          <button type="button" className="primary" onClick={() => runSelectionAction(onCreateAgentNode)}>
            创建 Agent 节点
          </button>
          <button type="button" onClick={() => runSelectionAction(onUseAsImagePrompt)}>
            转图片
          </button>
          <button type="button" onClick={() => runSelectionAction(onUseAsVideoPrompt)}>
            转视频
          </button>
        </div>
      ) : null}
      <div className="canvas-agent-dock-quick">
        {quickActions.map((action) => (
          <button key={action.label} type="button" onClick={() => setInput(action.prompt)} disabled={busy}>
            {action.label}
          </button>
        ))}
      </div>
      <form
        className="canvas-agent-dock-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) stop();
          else void send();
        }}
      >
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            const slashQuery = skillSlashQuery(value);
            if (slashQuery !== null) {
              skillMenuFromSlashRef.current = true;
              if (!skillMenuOpen) void refreshSkills();
              setSkillQuery(slashQuery);
              setSkillActive(0);
              setSkillMenuOpen(true);
            } else if (skillMenuFromSlashRef.current) {
              closeSkillMenu();
            }
          }}
          onKeyDown={(event) => {
            if (skillMenuOpen) {
              const visibleSkills = filterSkills(skills, skillQuery);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (visibleSkills.length) {
                  setSkillActive((current) => {
                    const next = event.key === "ArrowDown" ? current + 1 : current - 1;
                    return (next + visibleSkills.length) % visibleSkills.length;
                  });
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                closeSkillMenu();
                return;
              }
              if (
                skillMenuFromSlashRef.current &&
                (event.key === "Enter" || event.key === "Tab") &&
                !event.nativeEvent.isComposing &&
                visibleSkills.length
              ) {
                event.preventDefault();
                applySkill(visibleSkills[Math.min(Math.max(skillActive, 0), visibleSkills.length - 1)]);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (!busy) void send();
            }
          }}
          placeholder="问这只画布的 Agent，Enter 发送 / Shift+Enter 换行"
          rows={3}
          aria-label="给 Agent 的消息"
        />
        <div className="canvas-agent-dock-composer-row">
          <button
            type="button"
            className={`canvas-agent-dock-skill ${skillMenuOpen ? "is-active" : ""}`}
            onClick={() => (skillMenuOpen ? closeSkillMenu() : openSkillMenu(""))}
            title="选择技能：把某个技能指定给本轮任务"
            aria-haspopup="listbox"
            aria-expanded={skillMenuOpen}
          >
            <SkillIcon size={14} />
            <span>技能</span>
          </button>
          <SelectMenu
            value={model}
            options={modelOptions}
            onChange={setModel}
            ariaLabel="选择 Agent 模型"
            className="canvas-agent-dock-model"
            disabled={busy}
          />
          <button type="button" className="canvas-agent-dock-web" onClick={cycleWebMode} disabled={busy}>
            {WEB_MODE_LABELS[webMode]}
          </button>
          <label className="canvas-agent-dock-auto" title="Agent 返回图片时自动生成节点">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(event) => setAutoApply(event.target.checked)}
            />
            <span>自动落画布</span>
          </label>
          <button type="submit" className={`canvas-agent-dock-send ${busy ? "is-busy" : ""}`}>
            {busy ? "停止" : "发送"}
          </button>
        </div>
        <AgentSkillMenu
          open={skillMenuOpen}
          skills={skills}
          query={skillQuery}
          activeIndex={skillActive}
          onActiveIndexChange={setSkillActive}
          onSelect={applySkill}
          onClose={closeSkillMenu}
          emptyHint="还没有启用中的技能。点右上角的「技能」按钮可以安装或启用。"
        />
      </form>
    </aside>
  );
}
