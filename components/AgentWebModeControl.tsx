import type { ComponentType } from 'react';

export type AgentWebMode = 'auto' | 'always' | 'off';

type AgentWebModeControlProps = {
  mode: AgentWebMode;
  menuOpen: boolean;
  nativeSearchActive: boolean;
  nativeSearchHint: string;
  Icon: ComponentType<{ name: string; size?: number }>;
  onToggleMenu: () => void;
  onChange: (mode: AgentWebMode) => void;
};

/** Agent web-search preference control; persistence and request behavior remain page-owned. */
export default function AgentWebModeControl({
  mode,
  menuOpen,
  nativeSearchActive,
  nativeSearchHint,
  Icon,
  onToggleMenu,
  onChange,
}: AgentWebModeControlProps) {
  const modeLabel = mode === 'auto' ? '智能' : mode === 'always' ? '始终' : '关闭';
  const tooltip = mode === 'auto'
    ? '仅在需要最新或外部事实时搜索，普通创作会立即回复。'
    : mode === 'always'
      ? '每轮都会联网检索，回复可能较慢。'
      : '不会联网，适合最快的纯模型回复。';
  const options: Array<[AgentWebMode, string, string]> = [
    ['auto', '智能联网', nativeSearchActive ? '需要最新事实时优先使用模型原生搜索，失败回退外部 API' : '仅在需要最新或外部事实时使用外部搜索 API'],
    ['always', '始终联网', nativeSearchActive ? '每轮优先使用模型原生搜索，失败回退外部 API' : '每轮使用外部搜索 API，回复可能较慢'],
    ['off', '关闭联网', '最快的纯模型回复'],
  ];

  return (
    <div className="agent-web-toggle-wrap">
      <button
        type="button"
        className={`agent-web-mode-trigger ${mode}`}
        onClick={onToggleMenu}
        aria-describedby="agent-web-toggle-tip"
        aria-label="联网模式"
        aria-expanded={menuOpen}
      >
        <Icon name="globe" size={14} />
        <span>联网：{modeLabel}</span>
        <Icon name="down" size={13} />
      </button>
      {menuOpen && (
        <div className="agent-web-mode-menu" role="menu">
          {options.map(([value, label, description]) => (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={mode === value}
              className={mode === value ? 'active' : ''}
              onClick={() => onChange(value)}
              key={value}
            >
              <strong>{label}</strong>
              <small>{description}</small>
            </button>
          ))}
        </div>
      )}
      {!menuOpen && (
        <span id="agent-web-toggle-tip" className="agent-web-tooltip" role="tooltip">
          {tooltip} {nativeSearchHint}
        </span>
      )}
      <span className={`agent-native-search-hint ${nativeSearchActive ? 'active' : ''}`} title={nativeSearchHint}>
        {nativeSearchActive ? '模型自带搜索 · 优先使用' : '外部搜索 API'}
      </span>
    </div>
  );
}
