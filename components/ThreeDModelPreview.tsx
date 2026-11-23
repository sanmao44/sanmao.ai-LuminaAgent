"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { modelPreviewBytesLabel, modelPreviewDownloadProgress, type ModelPreviewDownloadProgress } from "@/components/cangyuan/three-d-preview-progress";
import { loadModelPreviewBytes } from "@/components/cangyuan/model-preview-bytes-cache";
import styles from "./ThreeDModelPreview.module.css";

type Props = {
  url: string;
  label: string;
  className?: string;
  variant?: "dialog";
};

function disposeModel(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export default function ThreeDModelPreview({ url, label, className, variant }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<"download" | "parse">("download");
  const [downloadProgress, setDownloadProgress] = useState<ModelPreviewDownloadProgress>(() => modelPreviewDownloadProgress(0, 0));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setError("");
    setLoading(true);
    setLoadingStage("download");
    setDownloadProgress(modelPreviewDownloadProgress(0, 0));
    let disposed = false;
    let modelRoot: THREE.Object3D | null = null;
    let frame = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#171b20");
    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 1000);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    } catch {
      setLoading(false);
      setError("浏览器当前无法创建三维预览，可直接下载模型文件。");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xf0f5ff, 0x343c46, 2.1));
    const keyLight = new THREE.DirectionalLight(0xfff0dc, 2.5);
    keyLight.position.set(3, 5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xc7e4ff, 1.15);
    fillLight.position.set(-4, 2, -3);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;

    const requestRender = () => {
      if (disposed || frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const moving = controls.update();
        renderer.render(scene, camera);
        if (moving) requestRender();
      });
    };
    controls.addEventListener("change", requestRender);

    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const loader = new GLTFLoader();
    const modelUrl = new URL(url, window.location.href);
    const resourcePath = new URL(".", modelUrl).toString();
    void loadModelPreviewBytes(url, (progress) => {
      if (disposed) return;
      setDownloadProgress(progress);
      if (progress.percentage === 100) setLoadingStage("parse");
    }).then(async (bytes) => {
      if (disposed) return null;
      setLoadingStage("parse");
      return loader.parseAsync(bytes, resourcePath);
    }).then((gltf) => {
      if (!gltf) return;
      if (disposed) {
        disposeModel(gltf.scene);
        return;
      }
      modelRoot = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(modelRoot);
      const center = bounds.getCenter(new THREE.Vector3());
      const sphere = bounds.getBoundingSphere(new THREE.Sphere());
      modelRoot.position.sub(center);
      scene.add(modelRoot);
      const radius = Math.max(0.05, sphere.radius);
      const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.55;
      camera.position.set(distance * 0.9, distance * 0.62, distance);
      camera.near = Math.max(0.001, radius / 1000);
      camera.far = Math.max(100, distance * 12);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.minDistance = radius * 1.2;
      controls.maxDistance = distance * 4;
      controls.update();
      setLoading(false);
      requestRender();
    }).catch(() => {
      if (!disposed) {
        setLoading(false);
        setError("模型无法在线预览，可直接下载模型文件。");
      }
    });
    requestRender();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", requestRender);
      controls.dispose();
      if (modelRoot) disposeModel(modelRoot);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return (
    <div className={[styles.preview, variant === "dialog" ? styles.inDialog : "", className].filter(Boolean).join(" ")} aria-label={`${label} 三维模型预览`}>
      <div className={styles.stage} ref={hostRef} />
      {loading && <div className={styles.loading} role="status" aria-live="polite">
        <div className={styles.loadingPanel}>
          <strong>{loadingStage === "download" ? "正在下载模型" : "正在解析模型"}</strong>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label={loadingStage === "download" ? "模型下载进度" : "模型解析进度"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={loadingStage === "download" ? downloadProgress.percentage ?? undefined : undefined}
            aria-valuetext={loadingStage === "download" && downloadProgress.percentage !== null
              ? `${downloadProgress.percentage}%`
              : loadingStage === "parse" ? "正在解析模型" : "下载进度未知"}
          >
            <span
              className={loadingStage === "parse" || downloadProgress.percentage === null ? styles.indeterminateProgress : styles.progressValue}
              style={loadingStage === "download" && downloadProgress.percentage !== null
                ? { width: `${downloadProgress.percentage}%` }
                : undefined}
            />
          </div>
          <small>{loadingStage === "parse"
            ? `已下载 ${modelPreviewBytesLabel(downloadProgress.loadedBytes)}，正在准备预览`
            : downloadProgress.percentage === null
              ? `已接收 ${modelPreviewBytesLabel(downloadProgress.loadedBytes)}`
              : `${downloadProgress.percentage}% · ${modelPreviewBytesLabel(downloadProgress.loadedBytes)}${downloadProgress.totalBytes === null ? "" : ` / ${modelPreviewBytesLabel(downloadProgress.totalBytes)}`}`}
          </small>
        </div>
      </div>}
      {error && <p className={styles.error} role="status">{error}</p>}
      <span className={styles.hint}>拖动旋转 · 滚轮缩放</span>
    </div>
  );
}
