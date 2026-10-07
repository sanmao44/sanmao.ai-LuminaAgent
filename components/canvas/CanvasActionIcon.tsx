"use client";

import type { ReactNode } from "react";
import AgentOrb from "@/components/AgentOrb";

export default function CanvasActionIcon({ name }: { name: string }) {
  const svg = (children: ReactNode) => (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
  switch (name) {
    case "edit":
      return svg(<><path d="m13.5 5.5 5 5" /><path d="m5 19 3.9-.9L18.7 8.3a2.1 2.1 0 0 0-3-3L5.9 15.1 5 19Z" /><path d="M13.5 5.5 18.7 10.7" /></>);
    case "image-operations":
      return svg(<><path d="M5 7h14" /><path d="M5 12h14" /><path d="M5 17h14" /><circle cx="9" cy="7" r="1.7" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none" /><circle cx="11" cy="17" r="1.7" fill="currentColor" stroke="none" /></>);
    case "more":
      return svg(<><circle cx="5.5" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.2" fill="currentColor" stroke="none" /></>);
    case "delete":
      return svg(<><path d="M5 7h14" /><path d="M9 7V5.5h6V7" /><path d="m7 7 .8 12h8.4L17 7" /><path d="M10 10.5v5.5M14 10.5v5.5" /></>);
    case "mask":
      return svg(<><rect x="4.5" y="4.5" width="15" height="15" rx="3" strokeDasharray="2.5 2.5" /><path d="M8 16 16 8" /><circle cx="8" cy="16" r="1.2" fill="currentColor" stroke="none" /><circle cx="16" cy="8" r="1.2" fill="currentColor" stroke="none" /></>);
    case "upscale":
      return svg(<><path d="M6 17 17 6" /><path d="M9 6h8v8" /><path d="M5 5h5M5 5v5" opacity=".58" /></>);
    case "reference":
      return svg(<><path d="M8.5 12h7" /><path d="M9.5 7.5 7 5a3.2 3.2 0 0 0-4.5 4.5l3 3a3.2 3.2 0 0 0 4.5 0l1-1" /><path d="m14.5 16.5 2.5 2.5a3.2 3.2 0 0 0 4.5-4.5l-3-3a3.2 3.2 0 0 0-4.5 0l-1 1" /></>);
    case "download":
      return svg(<><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /><path d="M5 19.5h14" /></>);
    case "asset":
      return svg(<><path d="M5 7.5 12 4l7 3.5v9L12 20l-7-3.5v-9Z" /><path d="M5.4 7.7 12 11l6.6-3.3" /><path d="M12 11v8.5" /></>);
    case "play":
      return svg(<path d="m9 6.5 8 5.5-8 5.5v-11Z" fill="currentColor" stroke="none" />);
    case "retry":
      return svg(<><path d="M18 8.5A7 7 0 1 0 19 14" /><path d="M18 4.5v4h-4" /></>);
    case "image":
      return svg(<><path d="m12 4 1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7L12 4Z" /><path d="m18.5 15 .7 1.8L21 17.5l-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" /></>);
    case "agent":
      return <AgentOrb state="idle" size={15} label="" />;
    case "preview":
      return svg(<><path d="M8 5H5v3M16 5h3v3M5 16v3h3M19 16v3h-3" /><path d="m9 9 6 6M15 9l-6 6" opacity=".5" /></>);
    case "reverse-prompt":
      return svg(<><path d="M5 6.5h14v11H5z" /><path d="m8 14 2.2-2.3 2 1.8 2.1-2.5 2.7 3" /><path d="M8 9h.01" /><path d="M18.5 4.5v4M16.5 6.5h4" /></>);
    case "copy":
    case "duplicate":
      return svg(<><rect x="8" y="8" width="10" height="10" rx="2" /><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>);
    case "arrange":
      return svg(<><rect x="4" y="5" width="6" height="6" rx="1" /><rect x="14" y="13" width="6" height="6" rx="1" /><path d="m10 8 4 4M14 8h-4v4" /></>);
    case "focus":
      return svg(<><path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M8 20H5a1 1 0 0 1-1-1v-3M16 20h3a1 1 0 0 0 1-1v-3" /><rect x="8" y="8" width="8" height="8" rx="1" /></>);
    case "ungroup":
      return svg(<><rect x="4" y="5" width="6" height="6" rx="1" /><rect x="14" y="13" width="6" height="6" rx="1" /><path d="M10 8h4v4" /></>);
    case "group-actions":
      return svg(<><rect x="4" y="5" width="7" height="7" rx="1.5" /><rect x="13" y="12" width="7" height="7" rx="1.5" /><path d="m10 12 3 0M12 10v4" /></>);
    case "layer":
      return svg(<><path d="m4 8 8-4 8 4-8 4-8-4Z" /><path d="m4 12 8 4 8-4M4 16l8 4 8-4" /></>);
    case "bring-to-front":
      return svg(<><path d="M6 17V7M6 7l-3 3M6 7l3 3M14 17V7M14 7l-3 3M14 7l3 3" /></>);
    case "bring-to-back":
      return svg(<><path d="M6 7v10M6 17l-3-3M6 17l3-3M14 7v10M14 17l-3-3M14 17l3-3" /></>);
    case "raise":
      return svg(<><path d="M12 19V5M7 10l5-5 5 5" /></>);
    case "lower":
      return svg(<><path d="M12 5v14M7 14l5 5 5-5" /></>);
    case "compose":
      return svg(<><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>);
    case "one-take":
      return svg(<><path d="M5 7.5h14v9H5z" /><path d="m10 10 4 2-4 2v-4ZM7 5v2M17 5v2" /></>);
    case "cinematic":
      return svg(<><path d="M4.5 7.5h15v9h-15z" /><path d="M8 5.5v2M12 5.5v2M16 5.5v2M8 16.5v2M12 16.5v2M16 16.5v2" /><path d="m10 10 4 2-4 2v-4Z" fill="currentColor" stroke="none" /></>);
    case "depth":
      return svg(<><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="8" cy="6" r="1.5" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="11" cy="18" r="1.5" fill="currentColor" stroke="none" /></>);
    case "angle":
      return svg(<><path d="m12 4 2.3 5.7L20 12l-5.7 2.3L12 20l-2.3-5.7L4 12l5.7-2.3L12 4Z" /><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" /></>);
    default:
      return <>{name}</>;
  }
}

