type McpIconProps = { size?: number };

/** MCP 入口图标：插头接入口，和技能图标区分开但同为线性风格。 */
export default function McpIcon({ size = 16 }: McpIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 3.8v4.4M15 3.8v4.4" />
      <path d="M6.5 8.2h11v3.3a5.5 5.5 0 0 1-11 0Z" />
      <path d="M12 17v3.4" />
    </svg>
  );
}
