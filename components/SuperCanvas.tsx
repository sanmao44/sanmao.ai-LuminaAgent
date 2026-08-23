'use client';

import { useRouter } from 'next/navigation';

/**
 * 超级画布（Super Canvas）占位组件。
 * 独立页面（路由 /canvas）入口，后续接入无限画布时可直接在此组件内实现：
 * 拖拽 / 缩放 / 画布内容管理 / 节点连线等逻辑。
 */
export default function SuperCanvas() {
  const router = useRouter();

  const goHome = () => {
    router.push('/');
  };

  return (
    <section className="super-canvas-page" aria-label="超级画布">
      <div className="super-canvas-toolbar">
        <div className="super-canvas-toolbar-left">
          <button
            type="button"
            className="super-canvas-back"
            onClick={goHome}
            aria-label="返回主界面"
          >
            <span className="super-canvas-back-arrow" aria-hidden="true">‹</span>
            <span>返回主界面</span>
          </button>
          <div className="super-canvas-mode-pill">
            <span className="super-canvas-mode-dot" aria-hidden="true" />
            <span>无限画布</span>
            <span className="super-canvas-mode-badge">即将上线</span>
          </div>
        </div>
        <div className="super-canvas-zoom">
          <button type="button" className="super-canvas-zoom-btn" aria-label="缩小" disabled>
            −
          </button>
          <span>100%</span>
          <button type="button" className="super-canvas-zoom-btn" aria-label="放大" disabled>
            +
          </button>
        </div>
      </div>

      <div className="super-canvas-stage">
        <div className="super-canvas-placeholder">
          <div className="super-canvas-spark" aria-hidden="true">✦</div>
          <div className="super-canvas-badge">超级画布</div>
          <h1>无限画布 · 即将上线</h1>
          <p>
            这里将接入无限画布，自由拖拽、缩放、连线，把灵感铺满整张画布。
            超级画布入口已经就位，后续版本会直接挂载到这一个页面。
          </p>
          <div className="super-canvas-tags">
            <span>自由拖拽</span>
            <span>无限缩放</span>
            <span>灵感连线</span>
          </div>
        </div>
      </div>

      <div className="super-canvas-hint">
        提示：点击左上角「返回主界面」即可回到 SANMAO.AI 主界面。当前为占位页面，无限画布将在后续版本接入。
      </div>
    </section>
  );
}
