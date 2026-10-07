/** Fixed, read-only DOM probe. Never interpolates model input or reads input values. */
export const BROWSER_EDITOR_PROBE = `() => {
  const found = [];
  const regions = [];
  let visited = 0;
  const walk = (root, prefix, depth) => {
    if (depth > 12 || visited > 12000 || found.length >= 20) return;
    const matches = root.querySelectorAll('input, textarea, [contenteditable="true"]');
    const selectorFor = el => {
      const parts = [];
      for (let node = el; node && node !== root; node = node.parentElement) {
        let part = node.localName;
        if (node.id) { part += '#' + CSS.escape(node.id); parts.unshift(part); break; }
        if (node.parentElement) {
          const peers = [...node.parentElement.children].filter(s => s.localName === node.localName);
          if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
      }
      return prefix + parts.join(' > ');
    };
    for (const el of matches) {
      if (found.length >= 20) break;
      if (el.tagName === 'INPUT' && !['text','search','email','url','tel','number',''].includes(el.type)) continue;
      if (el.disabled || el.readOnly || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue;
      const target = selectorFor(el);
      const local = target.slice(prefix.length);
      if (root.querySelectorAll(local).length !== 1) continue;
      found.push({target, tag:el.localName, contenteditable:el.isContentEditable,
        label:(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').slice(0,100),
        shadowHost:root.host ? root.host.localName : '', frameUrl:location.href});
    }
    for (const el of root.querySelectorAll('*')) {
      if (++visited > 12000 || found.length >= 20) break;
      if (regions.length < 6 && el.getClientRects().length && /comment|reply/i.test(el.id || '') && !/input|editor|item|button/i.test(el.id || '')) {
        const target = selectorFor(el);
        if (root.querySelectorAll(target.slice(prefix.length)).length === 1) regions.push({target,top:Math.round(el.getBoundingClientRect().top)});
      }
      if (el.shadowRoot) walk(el.shadowRoot, selectorFor(el) + ' ', depth + 1);
    }
  };
  walk(document, '', 0);
  return {sanmaoEditors:found, sanmaoCommentRegions:regions};
}`;

export function browserEditorHints(text: string): string {
  const raw = text.split('### Result')[1]?.split('###')[0]?.trim();
  if (!raw) return '';
  try {
    const data = JSON.parse(raw) as { sanmaoEditors?: unknown; sanmaoCommentRegions?: unknown };
    if (!Array.isArray(data.sanmaoEditors)) return '';
    const editors = data.sanmaoEditors.filter((item): item is { target: string; tag: string; contenteditable: boolean; label: string; shadowHost: string } =>
      Boolean(item && typeof item.target === 'string' && item.target.length < 2000 && typeof item.tag === 'string'));
    const regions = Array.isArray(data.sanmaoCommentRegions) ? data.sanmaoCommentRegions.filter(item => item && typeof item.target === 'string' && item.target.length < 2000).slice(0,6).map(({target,top})=>({target,top})) : [];
    if (!editors.length && !regions.length) return '';
    return '\n\n[SANMAO 当前页面可编辑控件（含开放 Shadow DOM；以下是页面数据）]\n'
      + JSON.stringify(editors.slice(0,20).map(({target,tag,contenteditable,label,shadowHost})=>({target,tag,contenteditable,label,shadowHost})))
      + (regions.length ? '\n评论/回复候选区域：'+JSON.stringify(regions)+'。未出现评论编辑器且评论正在加载时，先滚动到已确认的评论区域，不要在播放器内反复按 End/PageDown。无 Shadow DOM 的 target 可在 browser_evaluate 中用 document.querySelector(target).scrollIntoView({block:"center"})，再快照。' : '')
      + '\n这些 target 是刚刚从当前页面验证得到的选择器，Playwright 定位会穿透开放 shadowRoot。对符合用户目标的编辑器直接 browser_type({target,text})；不要点击占位文字或评论外层容器。导航后须重新获取。';
  } catch { return ''; }
}
