"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type CanvasProcessingKind =
  | "image"
  | "video"
  | "agent"
  | "generator"
  | "upscale";

type CanvasProcessingIndicatorProps = {
  label: string;
  progress?: number;
  startedAt?: number;
  waiting?: boolean;
  compact?: boolean;
  kind: CanvasProcessingKind;
};

type ProcessingClockListener = () => void;

const processingClockListeners = new Set<ProcessingClockListener>();
let processingClockNow = Date.now();
let processingClockTimer: number | null = null;

function publishProcessingClock() {
  processingClockNow = Date.now();
  processingClockListeners.forEach((listener) => listener());
}

function stopProcessingClock() {
  if (processingClockTimer === null || typeof window === "undefined") return;
  window.clearInterval(processingClockTimer);
  processingClockTimer = null;
}

function startProcessingClock() {
  if (
    processingClockTimer !== null ||
    typeof window === "undefined" ||
    window.document.visibilityState === "hidden"
  )
    return;
  publishProcessingClock();
  processingClockTimer = window.setInterval(publishProcessingClock, 1000);
}

function handleProcessingVisibility() {
  if (window.document.visibilityState === "hidden") stopProcessingClock();
  else startProcessingClock();
}

function subscribeProcessingClock(listener: ProcessingClockListener) {
  processingClockListeners.add(listener);
  if (processingClockListeners.size === 1 && typeof window !== "undefined") {
    window.document.addEventListener(
      "visibilitychange",
      handleProcessingVisibility,
    );
    startProcessingClock();
  }
  return () => {
    processingClockListeners.delete(listener);
    if (!processingClockListeners.size && typeof window !== "undefined") {
      stopProcessingClock();
      window.document.removeEventListener(
        "visibilitychange",
        handleProcessingVisibility,
      );
    }
  };
}

function processingClockSnapshot() {
  return processingClockNow;
}

function processingClockServerSnapshot() {
  return 0;
}

export function formatProcessingTime(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0)
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ProcessingGlyph({ kind }: { kind: CanvasProcessingKind }) {
  let glyph: ReactNode;
  if (kind === "video") {
    glyph = <path d="m9 7 6 5-6 5Z" fill="currentColor" stroke="none" />;
  } else if (kind === "agent") {
    glyph = (
      <>
        <path d="M12 4.5c.7 4.1 2.4 5.8 6.5 6.5-4.1.7-5.8 2.4-6.5 6.5-.7-4.1-2.4-5.8-6.5-6.5 4.1-.7 5.8-2.4 6.5-6.5Z" />
        <path d="M18.5 4.5v3M20 6h-3" />
      </>
    );
  } else if (kind === "generator") {
    glyph = (
      <>
        <rect x="6" y="6" width="4.5" height="4.5" rx="1" />
        <rect x="13.5" y="6" width="4.5" height="4.5" rx="1" />
        <rect x="6" y="13.5" width="4.5" height="4.5" rx="1" />
        <rect x="13.5" y="13.5" width="4.5" height="4.5" rx="1" />
      </>
    );
  } else if (kind === "upscale") {
    glyph = (
      <>
        <path d="M7 17 17 7M11 7h6v6" />
        <path d="M7 11v6h6" />
      </>
    );
  } else {
    glyph = (
      <>
        <rect x="5.5" y="6.5" width="13" height="11" rx="2" />
        <circle cx="10" cy="10" r="1.25" fill="currentColor" stroke="none" />
        <path d="m7.5 15 3-3 2.3 2.1 1.7-1.6 2 2.5" />
      </>
    );
  }
  return (
    <svg viewBox="0 0 24 24" focusable="false">
      {glyph}
    </svg>
  );
}

function processingStageLabel(
  kind: CanvasProcessingKind,
  waiting: boolean,
  hasProgress: boolean,
) {
  if (waiting) return "队列等待";
  if (kind === "video") return hasProgress ? "远程渲染" : "准备任务";
  if (kind === "agent") return "思考中";
  if (kind === "generator") return "分支处理中";
  if (kind === "upscale") return "放大处理中";
  return "生成处理中";
}

export default function CanvasProcessingIndicator({
  label,
  progress,
  startedAt,
  waiting = false,
  compact = false,
  kind,
}: CanvasProcessingIndicatorProps) {
  const now = useSyncExternalStore(
    subscribeProcessingClock,
    processingClockSnapshot,
    processingClockServerSnapshot,
  );
  const validStartedAt = Number.isFinite(startedAt)
    ? Number(startedAt)
    : undefined;
  const fallbackStartedAtRef = useRef(validStartedAt ?? Date.now());

  useEffect(() => {
    if (validStartedAt !== undefined)
      fallbackStartedAtRef.current = validStartedAt;
  }, [validStartedAt]);

  const elapsedMilliseconds = Math.max(
    0,
    now - (validStartedAt ?? fallbackStartedAtRef.current),
  );
  const elapsed = formatProcessingTime(elapsedMilliseconds);
  const hasProgress = typeof progress === "number";
  const phase = waiting ? "queued" : "running";
  const stageLabel = processingStageLabel(kind, waiting, hasProgress);

  return (
    <div
      className={`canvas-processing-indicator kind-${kind} is-${phase}${compact ? " compact" : ""}`}
      data-processing-phase={stageLabel}
      data-processing-kind={kind}
      role="status"
      aria-live="polite"
      aria-label={`${label}，${waiting ? "正在等待" : "正在运行"}`}
    >
      <span className="canvas-processing-visual" aria-hidden="true">
        <span className="canvas-processing-orbit orbit-outer" />
        <span className="canvas-processing-orbit orbit-inner" />
        <span className="canvas-processing-glyph">
          <ProcessingGlyph kind={kind} />
        </span>
        <span className="canvas-processing-live-dot" />
      </span>
      <span className="canvas-processing-copy">
        <span className="canvas-processing-title">
          <b>{label}</b>
          <em>
            <span className="canvas-processing-status-dot" aria-hidden="true" />
            {waiting ? "排队" : "运行"}
          </em>
        </span>
        <span className="canvas-processing-details">
          <small>{stageLabel}</small>
          <span className="canvas-processing-details-separator" aria-hidden="true">
            ·
          </span>
          <time
            className="canvas-processing-elapsed"
            dateTime={`PT${Math.floor(elapsedMilliseconds / 1000)}S`}
            aria-hidden="true"
          >
            {elapsed}
          </time>
          {hasProgress && (
            <small className="canvas-processing-percent">{progress}%</small>
          )}
        </span>
      </span>
      <span className="canvas-processing-signal" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span
        className={`canvas-processing-progress${hasProgress ? " determinate" : " indeterminate"}`}
        aria-hidden="true"
      >
        <i style={hasProgress ? { width: `${progress}%` } : undefined} />
      </span>
    </div>
  );
}
