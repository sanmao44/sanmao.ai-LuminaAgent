'use client';

import { useEffect, useState } from 'react';
import styles from './ImageStorageSettings.module.css';

type ImageStorageSettingsProps = {
  path: string;
  savedPath: string;
  busy: boolean;
  directoryName: string;
  onPathChange: (value: string) => void;
  onSave: (value: string) => Promise<void>;
  onOpen: () => Promise<void>;
  onChooseDirectory: () => Promise<void>;
  onClearDirectory: () => Promise<void>;
};

export default function ImageStorageSettings({
  path, savedPath, busy, directoryName, onPathChange, onSave, onOpen,
  onChooseDirectory, onClearDirectory,
}: ImageStorageSettingsProps) {
  const [canChooseDirectory, setCanChooseDirectory] = useState<boolean | null>(null);
  const [opening, setOpening] = useState(false);
  const [directoryBusy, setDirectoryBusy] = useState(false);
  const changed = path.trim() !== savedPath.trim();

  useEffect(() => {
    setCanChooseDirectory(window.isSecureContext && 'showDirectoryPicker' in window);
  }, []);

  async function openDirectory() {
    setOpening(true);
    try { await onOpen(); } finally { setOpening(false); }
  }

  async function updateExtraSave(clear: boolean) {
    setDirectoryBusy(true);
    try {
      if (clear) await onClearDirectory();
      else await onChooseDirectory();
    } finally { setDirectoryBusy(false); }
  }

  return (
    <section className={`${styles.panel} settings-card surface`} aria-label="图片存储">
      <div className={styles.heading}>
        <h2>应用图片库</h2>
        <span className={styles.badge}>应用所在电脑</span>
      </div>
      <p className={styles.note}>新图片自动保存到应用图片库。修改路径后需保存，已有图片不会搬移。</p>
      <label className={styles.field}>
        <span>图片库路径</span>
        <input
          value={path}
          onChange={event => onPathChange(event.target.value)}
          placeholder="留空使用默认图片库，或填写完整目录路径"
          disabled={busy}
          spellCheck={false}
        />
      </label>
      <p className={styles.saved} role="status">
        {changed ? '有未保存的修改。打开目录仍使用已保存的路径。' : savedPath.trim() ? `已保存：${savedPath}` : '当前使用默认图片库。'}
      </p>
      <div className={styles.actions}>
        <button type="button" className="primary-small" disabled={busy || !changed} onClick={() => void onSave(path)}>
          {busy ? '保存中…' : '保存路径'}
        </button>
        <button type="button" className="ghost-button" disabled={busy || (!path.trim() && !savedPath.trim())} onClick={() => void onSave('')}>恢复默认</button>
        <button type="button" className="ghost-button" disabled={busy || opening} onClick={() => void openDirectory()}>{opening ? '打开中…' : '打开已保存目录'}</button>
      </div>
      <details className={styles.details}>
        <summary>默认目录与历史图片</summary>
        <p>默认图片库位于用户目录下的 .sanmao-ai/media/images；启动配置可覆盖此位置。相对路径以应用运行目录为基准，建议填写完整路径。旧版 .data/images 和 image_generation_records 保留读取兼容。</p>
        <p>通过局域网访问时，此路径和“打开目录”作用于运行应用的电脑。</p>
      </details>

      <div className={styles.extra}>
        <div className={styles.heading}>
          <h3>浏览器额外保存</h3>
          <span className={styles.badge}>当前浏览器</span>
        </div>
        <p className={styles.note}>选择目录后，此浏览器会在生成图片时额外保存一份。该选择不会修改应用图片库，也不会复制已有图片。授权失效时，请重新选择目录。</p>
        <p className={styles.saved}>{directoryName ? `已选择：${directoryName}` : '未启用额外保存'}</p>
        {directoryName && <p className={styles.note}>停止后不再开始新的复制，正在写入的图片会完成保存。</p>}
        <div className={styles.actions}>
          <button type="button" className="ghost-button" disabled={!canChooseDirectory || directoryBusy} onClick={() => void updateExtraSave(false)}>{directoryBusy ? '处理中…' : directoryName ? '更换额外保存目录' : '选择额外保存目录'}</button>
          {directoryName && <button type="button" className="ghost-button" disabled={directoryBusy} onClick={() => void updateExtraSave(true)}>停止额外保存</button>}
        </div>
        {canChooseDirectory === false && <p className={styles.note}>需要在支持目录授权的 Chrome 或 Edge 中，通过 localhost 或 HTTPS 使用。应用图片库仍会正常保存。</p>}
      </div>
    </section>
  );
}
