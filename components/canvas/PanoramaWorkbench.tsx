"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  createViewpointCamera,
  normalizeViewpointOptions,
  type AngleCameraState,
  type AngleGenerationInput,
} from "@/lib/angle-control";
import type { ClientReferenceImage } from "@/lib/types";

type PanoramaWorkbenchProps = {
  reference: ClientReferenceImage;
  referenceWidth?: number;
  referenceHeight?: number;
  resultUrl?: string;
  modelId?: string;
  busy?: boolean;
  error?: string;
  onApply: (input: AngleGenerationInput) => void | Promise<void>;
  onClose: () => void;
};

function normalizePanoramaAngle(value: number) {
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.round(value) % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function cameraYawFromPanoramaAngle(angle: number) {
  const normalized = normalizePanoramaAngle(angle);
  return normalized > 180 ? normalized - 360 : normalized;
}

function panoramaAngleLabel(angle: number) {
  const normalized = normalizePanoramaAngle(angle);
  if (normalized === 0 || normalized === 360) return "原图角度";
  if (normalized < 45) return "右前方";
  if (normalized < 90) return "右侧前方";
  if (normalized < 135) return "右侧";
  if (normalized < 180) return "右后方";
  if (normalized === 180) return "背面";
  if (normalized < 225) return "左后方";
  if (normalized < 270) return "左侧";
  if (normalized < 315) return "左侧前方";
  return "左前方";
}

function outputForReference(referenceWidth?: number, referenceHeight?: number) {
  const width = Math.max(1, Math.round(Number(referenceWidth || 0) || 1024));
  const height = Math.max(1, Math.round(Number(referenceHeight || 0) || 1024));
  return {
    aspectRatio: `${width}:${height}`,
    width,
    height,
    referenceWidth: width,
    referenceHeight: height,
  };
}

function cameraForAngle(angle: number, modelId: string): AngleCameraState {
  return createViewpointCamera({
    yaw: cameraYawFromPanoramaAngle(angle),
    pitch: 0,
    roll: 0,
    modelId: modelId || "auto",
    viewpoint: normalizeViewpointOptions({
      subjectType: "unknown",
      mode: "object-orbit",
      modeSource: "manual",
      changeView: true,
      guide: false,
    }),
  });
}

export default function PanoramaWorkbench({
  reference,
  referenceWidth,
  referenceHeight,
  resultUrl,
  modelId = "auto",
  busy = false,
  error = "",
  onApply,
  onClose,
}: PanoramaWorkbenchProps) {
  const [angle, setAngle] = useState(0);
  const dialRef = useRef<HTMLDivElement | null>(null);
  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dial = dialRef.current;
    if (!dial) return;
    const rect = dial.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    const radians = Math.atan2(x, -y);
    setAngle(normalizePanoramaAngle((radians * 180) / Math.PI));
  };
  const startDialDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };
  const handleDialMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  };
  const applyAngle = () => {
    const camera = cameraForAngle(angle, modelId);
    const cameraStart = cameraForAngle(0, modelId);
    const output = outputForReference(referenceWidth, referenceHeight);
    const readableAngle = normalizePanoramaAngle(angle);
    const note = `保持原图内容、身份、姿态、构图和视觉风格，仅将相机水平环绕到相对原图 ${readableAngle}°，输出自然透视、比例正常、不拉伸不变形的普通图片。`;
    onApply({
      reference,
      output,
      camera,
      cameraStart,
      note,
      prompt: note,
    });
  };
  const displayAngle = Math.round(angle);
  const indicatorStyle = { transform: `rotate(${displayAngle}deg)` };

  return (
    <div
      className="canvas-modal-backdrop canvas-panorama-workbench"
      role="dialog"
      aria-modal="true"
      aria-label="360°视角"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section className="canvas-panorama-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="canvas-panorama-header">
          <div>
            <span>360° VIEW</span>
            <h2>选择图片视角</h2>
            <p>拖动方向盘选择水平机位，应用后生成一张正常透视的新图片。</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="关闭360°视角">×</button>
        </header>

        <div className="canvas-panorama-body">
          <div className="canvas-panorama-preview-grid">
            <div className="canvas-panorama-preview-pane">
              <div className="canvas-panorama-pane-label"><b>原始参考图</b><small>0° = 原图观察方向</small></div>
              <div className="canvas-panorama-image-frame">
                <img src={reference.dataUrl || reference.url} alt={reference.name} />
                <span className="canvas-panorama-image-badge">原图</span>
              </div>
            </div>
            <div className="canvas-panorama-preview-pane">
              <div className="canvas-panorama-pane-label"><b>{resultUrl ? "最近生成结果" : "方向示意"}</b><small>{resultUrl ? "自然透视结果" : "不伪造未见到的背面画面"}</small></div>
              <div className={`canvas-panorama-image-frame canvas-panorama-result-frame${resultUrl ? " has-result" : ""}`}>
                {resultUrl ? <img src={resultUrl} alt="生成的目标视角" /> : <div className="canvas-panorama-direction-preview"><div className="canvas-panorama-direction-object" style={indicatorStyle}><span>目标机位</span><i /></div><small>拖动下方方向盘选择角度</small></div>}
              </div>
            </div>
          </div>

          <div className="canvas-panorama-controls">
            <div className="canvas-panorama-readout">
              <span>当前水平角度</span>
              <strong>{displayAngle}°</strong>
              <b>{panoramaAngleLabel(displayAngle)}</b>
            </div>
            <div
              ref={dialRef}
              className="canvas-panorama-dial"
              role="slider"
              aria-label="水平视角"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={displayAngle}
              tabIndex={0}
              onPointerDown={startDialDrag}
              onPointerMove={handleDialMove}
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                  event.preventDefault();
                  setAngle((value) => normalizePanoramaAngle(value - 5));
                }
                if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setAngle((value) => normalizePanoramaAngle(value + 5));
                }
              }}
            >
              <span className="canvas-panorama-dial-mark top">0°</span>
              <span className="canvas-panorama-dial-mark right">90°</span>
              <span className="canvas-panorama-dial-mark bottom">180°</span>
              <span className="canvas-panorama-dial-mark left">270°</span>
              <div className="canvas-panorama-dial-ring"><i style={indicatorStyle}><b /></i><span>水平环绕</span></div>
            </div>
            <div className="canvas-panorama-control-copy">
              <p>原图方向会保留为参考标记。模型会重新生成目标机位的普通图片，不会把原图横向拉伸成全景展开图。</p>
              <button type="button" className="canvas-panorama-reset" onClick={() => setAngle(0)} disabled={busy || angle === 0}>↺ <span>回到原角度</span></button>
            </div>
          </div>

          {error && <div className="canvas-panorama-error" role="alert">{error}</div>}
          {busy && <div className="canvas-panorama-busy" role="status" aria-live="polite"><span className="mini-loader" /> 正在生成 {displayAngle}° 视角，原图不会被覆盖…</div>}
        </div>

        <footer className="canvas-panorama-footer">
          <span>{resultUrl ? "结果已写入画布，可继续选择其他角度。" : "生成后会创建新的图片节点，并自动连接到原图。"}</span>
          <div>
            <button type="button" onClick={onClose} disabled={busy}>关闭工作台</button>
            <button type="button" className="primary" onClick={applyAngle} disabled={busy}>{busy ? "生成中…" : "应用此角度"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
