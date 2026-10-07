"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import type { ClientReferenceImage } from "@/lib/types";

type PanoramaWorkbenchProps = {
  reference: ClientReferenceImage;
  referenceWidth?: number;
  referenceHeight?: number;
  isEquirectangular?: boolean;
  onApply?: (snapshot: PanoramaSnapshot) => Promise<void> | void;
  onClose: () => void;
};

export type PanoramaSnapshot = {
  dataUrl: string;
  width: number;
  height: number;
  yaw: number;
  pitch: number;
  fov: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeYaw(value: number) {
  const normalized = value % 360;
  return Math.round(normalized < 0 ? normalized + 360 : normalized);
}

function sourceAspect(width?: number, height?: number) {
  const safeWidth = Number(width);
  const safeHeight = Number(height);
  if (safeWidth > 0 && safeHeight > 0) return safeWidth / safeHeight;
  return 1;
}

function describeView(isEquirectangular: boolean) {
  return isEquirectangular
    ? {
        title: "360°球体查看",
        detail: "这是 2:1 等距柱状全景图，可自由环绕查看。",
        badge: "真实全景",
        controls: "拖动环绕 · 滚轮缩放 · 方向键微调",
        stageLabel: "拖动环绕查看全景，滚轮缩放",
      }
    : {
        title: "图片空间查看",
        detail: "普通图片以正面贴图显示，不会凭空生成背面内容。",
        badge: "普通图片",
        controls: "滚轮缩放 · 回到原始比例",
        stageLabel: "查看原图正面，滚轮缩放",
      };
}

export default function PanoramaWorkbench({
  reference,
  referenceWidth,
  referenceHeight,
  isEquirectangular = false,
  onApply,
  onClose,
}: PanoramaWorkbenchProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [yaw, setYaw] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [fov, setFov] = useState(72);
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  const fovRef = useRef(72);
  const view = describeView(isEquirectangular);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let animationFrame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let texture: THREE.Texture | null = null;
    let geometry: THREE.BufferGeometry | null = null;
    let material: THREE.Material | null = null;

    try {
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x08101c);
      const camera = new THREE.PerspectiveCamera(72, 1, 0.01, 100);
      camera.position.set(0, 0, 0.01);
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
        preserveDrawingBuffer: true,
      });
      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      host.appendChild(renderer.domElement);

      const imageUrl = String(reference.dataUrl || reference.url || "");
      if (!imageUrl) {
        setFailed(true);
        return () => {
          resizeObserver?.disconnect();
          renderer?.dispose();
          renderer?.domElement.remove();
        };
      }
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        imageUrl,
        (nextTexture) => {
          texture = nextTexture;
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.anisotropy = renderer?.capabilities.getMaxAnisotropy() || 1;
          if (isEquirectangular) {
            geometry = new THREE.SphereGeometry(20, 96, 64);
            geometry.scale(-1, 1, 1);
            material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
            scene.add(new THREE.Mesh(geometry, material));
          } else {
            const aspect = sourceAspect(referenceWidth, referenceHeight);
            const width = aspect >= 1 ? 7.2 : 7.2 * aspect;
            const height = aspect >= 1 ? 7.2 / aspect : 7.2;
            geometry = new THREE.PlaneGeometry(width, height);
            material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.FrontSide });
            const imagePlane = new THREE.Mesh(geometry, material);
            imagePlane.position.set(0, 0, -5);
            scene.add(imagePlane);
          }
          setLoaded(true);
        },
        undefined,
        () => setFailed(true),
      );

      const updateSize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer?.setSize(width, height, false);
      };
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(host);
      updateSize();

      const render = () => {
        camera.fov = fovRef.current;
        camera.rotation.order = "YXZ";
        camera.rotation.x = isEquirectangular
          ? THREE.MathUtils.degToRad(clamp(pitchRef.current, -82, 82))
          : 0;
        camera.rotation.y = isEquirectangular ? THREE.MathUtils.degToRad(yawRef.current) : 0;
        camera.updateProjectionMatrix();
        renderer?.render(scene, camera);
        animationFrame = window.requestAnimationFrame(render);
      };
      render();

      return () => {
        window.cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        texture?.dispose();
        geometry?.dispose();
        material?.dispose();
        renderer?.dispose();
        renderer?.domElement.remove();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
      };
    } catch {
      setFailed(true);
      return () => {
        window.cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        renderer?.dispose();
        renderer?.domElement.remove();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
      };
    }
  }, [isEquirectangular, reference.dataUrl, reference.url, referenceHeight, referenceWidth]);

  const adjustView = (deltaYaw: number, deltaPitch: number) => {
    yawRef.current += deltaYaw;
    pitchRef.current = clamp(pitchRef.current + deltaPitch, -82, 82);
    setYaw(normalizeYaw(yawRef.current));
    setPitch(Math.round(pitchRef.current));
  };

  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isEquirectangular) return;
    adjustView(event.movementX * 0.28, event.movementY * 0.22);
  };

  const updateZoom = (delta: number) => {
    fovRef.current = clamp(fovRef.current + delta, 35, 95);
    setFov(Math.round(fovRef.current));
  };

  const resetView = () => {
    yawRef.current = 0;
    pitchRef.current = 0;
    fovRef.current = 72;
    setYaw(0);
    setPitch(0);
    setFov(72);
  };

  const applyCurrentView = async () => {
    if (!onApply || !isEquirectangular || applying) return;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || !loaded) {
      setApplyError("全景尚未加载完成，请稍候再试。");
      return;
    }

    setApplying(true);
    setApplyError("");
    try {
      renderer.render(scene, camera);
      const canvas = renderer.domElement;
      if (!canvas.width || !canvas.height) throw new Error("当前视角没有可导出的画面。");
      const dataUrl = canvas.toDataURL("image/png");
      if (!dataUrl.startsWith("data:image/png")) throw new Error("当前视角导出失败，请重试。");
      await onApply({
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        yaw: normalizeYaw(yawRef.current),
        pitch: Math.round(pitchRef.current),
        fov: Math.round(fovRef.current),
      });
      onClose();
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : "当前视角导出失败，请重试。");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      className="canvas-modal-backdrop canvas-spherical-workbench"
      role="dialog"
      aria-modal="true"
      aria-label="360°球体查看"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="canvas-spherical-dialog" onClick={(event) => event.stopPropagation()}>
        <header className="canvas-spherical-header">
          <div>
            <span>360° VIEWER</span>
            <h2>{view.title}</h2>
            <p>{view.detail}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭360°查看">×</button>
        </header>

        <div
          ref={hostRef}
          className={`canvas-spherical-stage${isEquirectangular ? " is-equirectangular" : ""}${failed ? " is-failed" : ""}`}
          onPointerDown={(event) => {
            if (!isEquirectangular) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
          }}
          onWheel={(event) => {
            event.preventDefault();
            updateZoom(event.deltaY > 0 ? 4 : -4);
          }}
          onKeyDown={(event) => {
            if (isEquirectangular && event.key === "ArrowLeft") adjustView(-5, 0);
            if (isEquirectangular && event.key === "ArrowRight") adjustView(5, 0);
            if (isEquirectangular && event.key === "ArrowUp") adjustView(0, -4);
            if (isEquirectangular && event.key === "ArrowDown") adjustView(0, 4);
            if (event.key === "+" || event.key === "=") updateZoom(-4);
            if (event.key === "-") updateZoom(4);
          }}
          tabIndex={0}
          aria-label={view.stageLabel}
        >
          {failed && <div className="canvas-spherical-fallback"><strong>无法加载图片纹理</strong><span>可关闭查看器返回画布。</span></div>}
          {!loaded && !failed && <div className="canvas-spherical-loading">正在加载图片…</div>}
          <div className="canvas-spherical-badge">{view.badge}</div>
          <div className="canvas-spherical-hud">
            <strong>{isEquirectangular ? `${normalizeYaw(yaw)}°` : `${fov}°`}</strong>
            <span>{isEquirectangular ? `水平 · ${pitch}° 垂直 · ${fov}° 视野` : "当前视野"}</span>
          </div>
          <div className="canvas-spherical-help">{view.controls}</div>
        </div>

        <footer className="canvas-spherical-footer">
          <span>
            {applyError
              ? applyError
              : isEquirectangular
                ? "原图方向为 0°，可自由查看完整球体。"
                : "兼容模式：只显示原图正面，背面没有可用图像。"}
          </span>
          <div>
            <button type="button" onClick={resetView}>↺ 回到原始方向</button>
            {isEquirectangular && onApply && (
              <button type="button" className="primary" onClick={applyCurrentView} disabled={applying || !loaded || failed}>
                {applying ? "正在应用…" : "应用为平面图片"}
              </button>
            )}
            <button type="button" onClick={onClose}>关闭查看器</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
