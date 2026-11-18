'use client';

import { useMemo, useState } from 'react';

export default function CangyuanReferenceImagePreview({ url }: { url: string }) {
  const [failedUrl, setFailedUrl] = useState('');
  const previewUrl = useMemo(() => {
    const value = url.trim();
    try {
      const parsed = new URL(value);
      if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) return '';
      const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return '';
      const octets = host.split('.').map(Number);
      if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
        const [first, second] = octets;
        if (first === 0 || first === 10 || first === 127 || first >= 224 || first === 169 && second === 254 || first === 172 && second >= 16 && second <= 31 || first === 192 && second === 168) return '';
      }
      return value;
    } catch {
      return '';
    }
  }, [url]);

  if (!url.trim()) return null;
  if (!previewUrl) return <p className="cangyuan-reference-preview-state" role="status">请输入完整的公网图片 URL；本地地址、内网地址和 Base64 不可用。</p>;
  if (failedUrl === previewUrl) return <p className="cangyuan-reference-preview-state" role="status">预览加载失败，请确认图片链接可公开访问，且图片格式受浏览器支持。</p>;

  return (
    <figure className="cangyuan-reference-preview">
      <img src={previewUrl} alt="三维生成参考图预览" onError={() => setFailedUrl(previewUrl)} />
      <figcaption>参考图预览 · 提交时仍会由服务端检查地址</figcaption>
    </figure>
  );
}
