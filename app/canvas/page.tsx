import AdminAccessGate from '@/components/AdminAccessGate';
import SuperCanvas from '@/components/SuperCanvas';

/**
 * 超级画布独立页面。
 * 拥有独立 URL（/canvas）、全屏、隐藏主界面顶栏/侧栏。
 * 后续无限画布逻辑直接挂载到 components/SuperCanvas.tsx。
 */
export default function CanvasPage() {
  return (
    <AdminAccessGate>
      <SuperCanvas />
    </AdminAccessGate>
  );
}
