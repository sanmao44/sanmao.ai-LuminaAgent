import type {
  CanvasVideoEditorClip,
  CanvasVideoEditorState,
} from "./types";

export type CanvasVideoEditorRenderSource = {
  nodeId: string;
  kind: "image" | "video" | "audio";
  url: string;
  nativeWidth?: number;
  nativeHeight?: number;
};

export type RenderedCanvasVideoEditor = {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  width: number;
  height: number;
};

type RenderItem = {
  clip: CanvasVideoEditorClip;
  source: CanvasVideoEditorRenderSource;
  element: HTMLMediaElement | HTMLImageElement;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function projectDimensions(aspect: string, resolution: CanvasVideoEditorState["resolution"]) {
  const match = String(aspect || "16:9").match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  const ratio = match ? Number(match[1]) / Number(match[2]) : 16 / 9;
  const height = resolution === "720p" ? 720 : resolution === "2K" ? 1440 : resolution === "4K" ? 2160 : 1080;
  return {
    width: Math.max(1, Math.round(height * (Number.isFinite(ratio) && ratio > 0 ? ratio : 16 / 9))),
    height,
  };
}

function supportedRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function waitForEvent(target: HTMLMediaElement | HTMLImageElement, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("无法读取视频编辑素材"));
    };
    const cleanup = () => {
      target.removeEventListener(eventName, onEvent);
      target.removeEventListener("error", onError);
    };
    target.addEventListener(eventName, onEvent, { once: true });
    target.addEventListener("error", onError, { once: true });
  });
}

async function loadRenderItem(
  clip: CanvasVideoEditorClip,
  source: CanvasVideoEditorRenderSource,
): Promise<RenderItem> {
  if (source.kind === "image") {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = source.url;
    if (!image.complete) await waitForEvent(image, "load");
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("无法读取视频编辑图片素材");
    return { clip, source, element: image };
  }

  const media = document.createElement(source.kind === "audio" ? "audio" : "video");
  media.preload = "auto";
  if (media instanceof HTMLVideoElement) media.playsInline = true;
  media.crossOrigin = "anonymous";
  media.src = source.url;
  if (media.readyState < 1) await waitForEvent(media, "loadedmetadata");
  // The timeline already carries the authoritative clip duration. Some
  // browser-served blobs expose `NaN`/`Infinity` here even after metadata is
  // available; that must not prevent an otherwise playable source exporting.
  if (media.readyState < 1) throw new Error("无法读取视频编辑素材");
  return { clip, source, element: media };
}

function sourceSize(item: RenderItem) {
  const { element, source } = item;
  if (element instanceof HTMLVideoElement) {
    return { width: element.videoWidth || source.nativeWidth || 1, height: element.videoHeight || source.nativeHeight || 1 };
  }
  if (element instanceof HTMLImageElement) {
    return { width: element.naturalWidth || source.nativeWidth || 1, height: element.naturalHeight || source.nativeHeight || 1 };
  }
  return { width: 1, height: 1 };
}

function clipIsActive(clip: CanvasVideoEditorClip, time: number) {
  return time >= clip.start && time < clip.start + clip.duration;
}

function sourceTimeForClip(clip: CanvasVideoEditorClip, time: number) {
  return Math.max(0, clip.sourceOffset + (time - clip.start) * (clip.playbackRate || 1));
}

function drawVisual(
  context: CanvasRenderingContext2D,
  item: RenderItem,
  width: number,
  height: number,
) {
  if (!(item.element instanceof HTMLVideoElement || item.element instanceof HTMLImageElement)) return;
  const source = sourceSize(item);
  const fit = item.clip.fit || "contain";
  const fitScale = fit === "cover"
    ? Math.max(width / source.width, height / source.height)
    : Math.min(width / source.width, height / source.height);
  const scale = fitScale * clamp(item.clip.scale ?? 1, 0.1, 4);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  const x = (width - drawWidth) / 2 + (item.clip.x ?? 0) * width / 2;
  const y = (height - drawHeight) / 2 + (item.clip.y ?? 0) * height / 2;
  context.save();
  context.globalAlpha = clamp(item.clip.opacity ?? 1, 0, 1);
  context.drawImage(item.element, x, y, drawWidth, drawHeight);
  context.restore();
}

function drawCaption(
  context: CanvasRenderingContext2D,
  clip: CanvasVideoEditorClip,
  width: number,
  height: number,
) {
  const text = clip.text?.trim();
  if (!text) return;
  const fontSize = Math.max(12, Math.round((clip.fontSize ?? Math.min(width, height) * 0.038) * (clip.scale ?? 1)));
  const maxWidth = width * 0.82;
  context.save();
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    const candidate = line + character;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = character;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  const lineHeight = fontSize * 1.35;
  const centerX = width / 2 + (clip.x ?? 0) * width / 2;
  const centerY = height * (0.83 - (clip.y ?? 0) * 0.45);
  const boxWidth = Math.min(maxWidth + fontSize, Math.max(...lines.map((value) => context.measureText(value).width), 0) + fontSize);
  const boxHeight = lines.length * lineHeight + fontSize * 0.7;
  context.fillStyle = `rgba(0, 0, 0, ${clamp(clip.captionBackgroundOpacity ?? 0.68, 0, 1)})`;
  context.roundRect(centerX - boxWidth / 2, centerY - boxHeight / 2, boxWidth, boxHeight, fontSize * 0.3);
  context.fill();
  context.fillStyle = "#fff";
  lines.forEach((value, index) => context.fillText(value, centerX, centerY + (index - (lines.length - 1) / 2) * lineHeight));
  context.restore();
}

/** Render the complete editor timeline into a standalone browser video. */
export async function renderCanvasVideoEditor(
  state: CanvasVideoEditorState,
  sources: readonly CanvasVideoEditorRenderSource[],
  onProgress?: (progress: number) => void,
): Promise<RenderedCanvasVideoEditor> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器不支持成片导出，请使用 Chromium 内核浏览器。");
  }
  const mime = supportedRecorderMime();
  if (!mime) throw new Error("当前浏览器不支持 WebM 视频导出。");

  const durationSeconds = Math.max(0.1, state.projectDuration, ...state.clips.map((clip) => clip.start + clip.duration));
  const { width, height } = projectDimensions(state.aspect, state.resolution);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器不支持视频合成画布。");

  const sourceMap = new Map(sources.map((source) => [source.nodeId, source]));
  const items = (await Promise.all(state.clips
    .filter((clip) => !state.disabledTracks?.includes(clip.track) && clip.sourceNodeId && sourceMap.has(clip.sourceNodeId))
    .map(async (clip) => loadRenderItem(clip, sourceMap.get(clip.sourceNodeId as string) as CanvasVideoEditorRenderSource))))
    .filter((item): item is RenderItem => Boolean(item));
  const mediaItems = items.filter((item): item is RenderItem & { element: HTMLMediaElement } => item.element instanceof HTMLMediaElement);
  const canvasStream = canvas.captureStream(Math.max(1, Math.min(60, Math.round(state.fps || 30))));
  let audioContext: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  const audioSources: MediaElementAudioSourceNode[] = [];
  if (typeof AudioContext !== "undefined" && mediaItems.some((item) => item.clip.track === "audio" || item.clip.track === "video")) {
    audioContext = new AudioContext();
    audioDestination = audioContext.createMediaStreamDestination();
    for (const item of mediaItems) {
      if (state.mutedTracks.includes(item.clip.track) || (item.clip.volume ?? 1) <= 0) continue;
      const mediaSource = audioContext.createMediaElementSource(item.element);
      const gain = audioContext.createGain();
      gain.gain.value = clamp(item.clip.volume ?? 1, 0, 1);
      mediaSource.connect(gain).connect(audioDestination);
      audioSources.push(mediaSource);
    }
    audioDestination.stream.getAudioTracks().forEach((track) => canvasStream.addTrack(track));
    await audioContext.resume();
  }

  const chunks: Blob[] = [];
  let recorder: MediaRecorder | undefined;
  let timerId: number | undefined;
  let finished = false;
  const stop = () => {
    if (finished) return;
    finished = true;
    if (timerId !== undefined) window.clearInterval(timerId);
    mediaItems.forEach(({ element }) => element.pause());
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };
  const result = new Promise<Blob>((resolve, reject) => {
    recorder = new MediaRecorder(canvasStream, { mimeType: mime });
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    });
    recorder.addEventListener("error", () => reject(new Error("成片导出失败，请重试。")), { once: true });
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mime })), { once: true });
  });

  const syncMedia = (time: number) => {
    for (const item of mediaItems) {
      const active = clipIsActive(item.clip, time);
      const media = item.element;
      if (!active) {
        media.pause();
        continue;
      }
      const sourceDuration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : Number.POSITIVE_INFINITY;
      const desired = Math.min(sourceTimeForClip(item.clip, time), Math.max(0, sourceDuration - 0.01));
      if (Math.abs(media.currentTime - desired) > 0.35) media.currentTime = desired;
      media.playbackRate = item.clip.playbackRate || 1;
      if (media.paused) void media.play().catch(() => undefined);
    }
  };
  const draw = (time: number) => {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    items.filter((item) => item.clip.track === "video" && clipIsActive(item.clip, time)).forEach((item) => drawVisual(context, item, width, height));
    state.clips
      .filter((clip) => clip.track === "caption" && !state.disabledTracks?.includes("caption") && clipIsActive(clip, time))
      .forEach((clip) => drawCaption(context, clip, width, height));
  };

  try {
    syncMedia(0);
    draw(0);
    const activeRecorder = recorder;
    if (!activeRecorder) throw new Error("成片导出初始化失败，请重试。");
    activeRecorder.start(250);
    const startedAt = performance.now();
    timerId = window.setInterval(() => {
      const elapsed = Math.max(0, (performance.now() - startedAt) / 1000);
      const time = Math.min(durationSeconds, elapsed);
      syncMedia(time);
      draw(time);
      onProgress?.(Math.min(1, time / durationSeconds));
      if (time >= durationSeconds) stop();
    }, Math.max(16, Math.round(1000 / Math.max(1, Math.min(60, state.fps || 30)))));
    const blob = await result;
    return { blob, mime, durationSeconds, width, height };
  } finally {
    if (timerId !== undefined) window.clearInterval(timerId);
    if (recorder && recorder.state !== "inactive") recorder.stop();
    mediaItems.forEach(({ element }) => {
      element.pause();
      element.removeAttribute("src");
      element.load();
    });
    audioSources.forEach((source) => source.disconnect());
    if (audioContext) await audioContext.close().catch(() => undefined);
    canvasStream.getTracks().forEach((track) => track.stop());
  }
}
