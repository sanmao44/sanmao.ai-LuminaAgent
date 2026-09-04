import type { Metadata, Viewport } from 'next';
import './globals.css';
import './provider-library.css';
import './agent-upgrades.css';
import './desktop-readability.css';
import './canvas.css';
import './motion.css';
import LocalLifecycle from '@/components/LocalLifecycle';
import MotionPreference from '@/components/MotionPreference';

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: '#f5f6f8',
};

export const metadata: Metadata = {
  title: 'SANMAO.AI',
  description: '多模型 AI 生图平台与智能创作助手',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/brand-mark.png', apple: '/brand-mark.png' },
};

const themeBootScript = `
(function(){
  try {
    var saved = localStorage.getItem('sanmao-theme');
    var theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    var motion = localStorage.getItem('sanmao-motion-preference');
    if (motion === 'on' || motion === 'off') document.documentElement.dataset.motion = motion;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f1117' : '#f5f6f8');
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
`;

// After a forced update reload the cache-busting query is only needed to make
// the browser re-request the document once. Strip it on arrival so the shared /
// LAN URL stays clean and the app-router never sees a stale marker parameter.
const reloadCleanupScript = `
(function(){
  try {
    var url = new URL(window.location.href);
    if (url.searchParams.has('sanmao_reload')) {
      url.searchParams.delete('sanmao_reload');
      window.history.replaceState(null, '', url.toString());
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
        <script dangerouslySetInnerHTML={{ __html: reloadCleanupScript }} />
      </head>
      <body><MotionPreference /><LocalLifecycle />{children}</body>
    </html>
  );
}
