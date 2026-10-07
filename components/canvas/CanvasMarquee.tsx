"use client";

export type CanvasMarqueeState = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type CanvasMarqueeProps = {
  marquee: CanvasMarqueeState | null;
  selectedCount: number;
};

export default function CanvasMarquee({ marquee, selectedCount }: CanvasMarqueeProps) {
  if (!marquee) return null;

  const width = Math.abs(marquee.w);
  const height = Math.abs(marquee.h);
  const chipVisible = width >= 132 && height >= 40;
  const countVisible = width >= 178;

  return (
    <div
      className="canvas-marquee"
      style={{
        left: Math.min(marquee.x, marquee.x + marquee.w),
        top: Math.min(marquee.y, marquee.y + marquee.h),
        width,
        height,
      }}
    >
      <svg className="canvas-marquee-outline" aria-hidden="true">
        <rect
          className="canvas-marquee-rail"
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx="15"
          ry="15"
        />
        <rect
          className="canvas-marquee-flow-stroke"
          x="0"
          y="0"
          width="100%"
          height="100%"
          rx="15"
          ry="15"
        />
      </svg>
      {chipVisible && (
        <span className="canvas-marquee-chip">
          <i aria-hidden="true" />
          <b>
            {Math.round(width)} × {Math.round(height)} px
          </b>
          {countVisible && <small>已选 {selectedCount} 个</small>}
        </span>
      )}
    </div>
  );
}
