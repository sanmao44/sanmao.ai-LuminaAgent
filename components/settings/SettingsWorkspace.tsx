'use client';

import { useId, useState, type ReactNode } from 'react';
import styles from './SettingsWorkspace.module.css';

export type SettingsWorkspaceProps = {
  preferences: ReactNode;
  network: ReactNode;
  storage: ReactNode;
  backup: ReactNode;
  maintenance: ReactNode;
};

type SettingsCategory = keyof SettingsWorkspaceProps;

type CategoryDescription = {
  id: SettingsCategory;
  label: string;
  summary: string;
  title: string;
  description: string;
  saveHint: string;
};

const categories: readonly CategoryDescription[] = [
  {
    id: 'preferences',
    label: '偏好',
    summary: '界面与通知',
    title: '界面与通知',
    description: '调整主题和提示音，让工作环境更顺手。',
    saveHint: '更改后即时生效',
  },
  {
    id: 'network',
    label: '联网',
    summary: '搜索来源与连接',
    title: '联网搜索',
    description: '查看搜索来源与连接状态，管理备用搜索服务。',
    saveHint: '新 Key 测试成功后自动保存',
  },
  {
    id: 'storage',
    label: '存储',
    summary: '图片保存位置',
    title: '图片与存储',
    description: '管理应用的图片保存位置与浏览器额外保存目录。',
    saveHint: '修改路径后需要保存',
  },
  {
    id: 'backup',
    label: '备份',
    summary: '导出与恢复',
    title: '备份与恢复',
    description: '导出工作数据、恢复备份，或查看自动快照。',
    saveHint: '恢复操作会再次确认',
  },
  {
    id: 'maintenance',
    label: '维护',
    summary: '后台服务与日志',
    title: '运行与维护',
    description: '检查后台服务、载入最新代码，并管理生成日志。',
    saveHint: '重启期间页面会暂时断开',
  },
];

export default function SettingsWorkspace(props: SettingsWorkspaceProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('preferences');
  const workspaceId = useId();

  return (
    <>
    <header className={styles.pageHeader}><h1>设置</h1></header>
    <div className={styles.workspace}>
      <nav className={styles.navigation} aria-label="设置分类">
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={styles.navigationButton}
            aria-pressed={activeCategory === category.id}
            aria-controls={`${workspaceId}-${category.id}`}
            onClick={() => setActiveCategory(category.id)}
          >
            <span>{category.label}</span>
            <small>{category.summary}</small>
          </button>
        ))}
      </nav>
      <div className={styles.contentArea}>
        {categories.map((category) => (
          <section
            key={category.id}
            id={`${workspaceId}-${category.id}`}
            className={styles.group}
            aria-labelledby={`${workspaceId}-${category.id}-title`}
            hidden={activeCategory !== category.id}
          >
            <header className={styles.groupHeader}>
              <div>
                <h2 id={`${workspaceId}-${category.id}-title`}>{category.title}</h2>
                <p>{category.description}</p>
              </div>
              <span className={styles.saveHint}>{category.saveHint}</span>
            </header>
            <div className={`${styles.contents} ${category.id === 'preferences' ? styles.preferences : ''}`}>
              {props[category.id]}
            </div>
          </section>
        ))}
      </div>
    </div>
    </>
  );
}
