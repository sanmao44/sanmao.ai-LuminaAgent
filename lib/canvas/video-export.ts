import type {
  CanvasVideoEditorClip,
  CanvasVideoEditorState,
} from "./types";
import { videoEditorAudioGain, videoEditorLayoutRegions, videoEditorMotionTransform, videoEditorTextBox } from "./video-editor";
import { fitCanvasText } from "./text-layout";
import { writeWebmDuration } from "./webm-duration";

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

function graphicsStyleFlags(value: string | undefined) {
  const style = String(value || "").toLocaleLowerCase();
  return {
    card: /card|box|solid|label|tag|banner|色块|卡片|标签|底板/u.test(style),
    outline: /outline|outlined|stroke|描边|空心/u.test(style),
  };
}

function drawLayoutBackdrop(context: CanvasRenderingContext2D, layout: CanvasVideoEditorClip["layout"] | undefined, width: number, height: number) {
  if (!layout) return;
  const regions = videoEditorLayoutRegions(layout);
  const background = layout.backgroundColor || "#000";
  context.save();
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);
  if (layout.mode !== "full") {
    context.fillStyle = layout.surfaceColor || "rgba(255,255,255,.08)";
    [regions.primary, regions.secondary].filter(Boolean).forEach((region) => {
      if (!region) return;
      context.beginPath();
      context.roundRect(region.x * width, region.y * height, region.width * width, region.height * height, region.radius * Math.min(width, height));
      context.fill();
    });
  }
  context.restore();
}

function drawVisual(
  context: CanvasRenderingContext2D,
  item: RenderItem,
  width: number,
  height: number,
  options: { opacity?: number; motion?: { x: number; y: number; scale: number }; region?: ReturnType<typeof videoEditorLayoutRegions>["primary"]; reveal?: { direction: "left" | "right" | "up" | "down"; progress: number }; slide?: { direction: "left" | "right" | "up" | "down"; progress: number } } = {},
) {
  if (!(item.element instanceof HTMLVideoElement || item.element instanceof HTMLImageElement)) return;
  const source = sourceSize(item);
  const layout = options.region || videoEditorLayoutRegions(item.clip.layout).primary;
  const regionWidth = width * layout.width;
  const regionHeight = height * layout.height;
  const regionX = width * layout.x;
  const regionY = height * layout.y;
  const fit = item.clip.fit || "contain";
  const fitScale = fit === "cover"
    ? Math.max(regionWidth / source.width, regionHeight / source.height)
    : Math.min(regionWidth / source.width, regionHeight / source.height);
  const scale = fitScale * clamp(item.clip.scale ?? 1, 0.1, 4) * (options.motion?.scale ?? 1);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  let x = regionX + (regionWidth - drawWidth) / 2 + ((item.clip.x ?? 0) + (options.motion?.x ?? 0)) * width / 2;
  let y = regionY + (regionHeight - drawHeight) / 2 + ((item.clip.y ?? 0) + (options.motion?.y ?? 0)) * height / 2;
  if (options.slide) {
    const distance = options.slide.direction === "left" || options.slide.direction === "right" ? regionWidth : regionHeight;
    const sign = options.slide.direction === "right" || options.slide.direction === "down" ? 1 : -1;
    if (options.slide.direction === "left" || options.slide.direction === "right") x += sign * distance * (1 - options.slide.progress);
    else y += sign * distance * (1 - options.slide.progress);
  }
  context.save();
  context.globalAlpha = clamp((item.clip.opacity ?? 1) * (options.opacity ?? 1), 0, 1);
  if (options.reveal) {
    const progress = clamp(options.reveal.progress, 0, 1);
    context.beginPath();
    if (options.reveal.direction === "left") context.rect(regionX, regionY, regionWidth * progress, regionHeight);
    else if (options.reveal.direction === "right") context.rect(regionX + regionWidth * (1 - progress), regionY, regionWidth * progress, regionHeight);
    else if (options.reveal.direction === "up") context.rect(regionX, regionY, regionWidth, regionHeight * progress);
    else context.rect(regionX, regionY + regionHeight * (1 - progress), regionWidth, regionHeight * progress);
    context.clip();
  }
  if (layout.radius > 0) {
    context.beginPath();
    context.roundRect(regionX, regionY, regionWidth, regionHeight, layout.radius * Math.min(width, height));
    context.clip();
  }
  context.drawImage(item.element, x, y, drawWidth, drawHeight);
  context.restore();
}

function drawVisualLayers(
  context: CanvasRenderingContext2D,
  item: RenderItem,
  width: number,
  height: number,
  options: Parameters<typeof drawVisual>[4] = {},
) {
  const regions = videoEditorLayoutRegions(item.clip.layout);
  drawVisual(context, item, width, height, { ...options, region: regions.primary });
  if (regions.secondary) drawVisual(context, item, width, height, { ...options, region: regions.secondary });
}

function transitionDirection(clip: CanvasVideoEditorClip) {
  return clip.transitionDirection || "left";
}

function transitionProgress(clip: CanvasVideoEditorClip, time: number) {
  const duration = Math.max(0.05, clip.transitionDuration || 0.24);
  return clamp((time - clip.start) / duration, 0, 1);
}

function drawCaption(
  context: CanvasRenderingContext2D,
  clip: CanvasVideoEditorClip,
  width: number,
  height: number,
  time = clip.start,
) {
  const relativeTime = Math.max(0, time - clip.start);
  const normalizedCaption = (clip.text || '').replace(/\s+/gu, '');
  const timedText = clip.words?.length && clip.words.map((word) => word.text).join('').replace(/\s+/gu, '') === normalizedCaption
    ? clip.words.filter((word) => word.start <= relativeTime).map((word) => word.text).join('')
    : clip.text;
  const text = timedText?.trim();
  if (!text) return;
  const graphics = clip.track === "graphics";
  const style = graphicsStyleFlags(clip.graphicsStyle);
  const textBox = graphics ? videoEditorTextBox(clip) : undefined;
  const fontSize = Math.max(12, Math.round((clip.fontSize ?? Math.min(width, height) * 0.038) * (clip.scale ?? 1)));
  const maxWidth = textBox ? width * textBox.width : width * 0.82;
  const maxHeight = textBox ? height * textBox.height : height * 0.36;
  context.save();
  const fitted = fitCanvasText({
    text,
    fontSize,
    minFontSize: 12,
    maxWidth,
    maxHeight,
    measure: (value, size) => {
      context.font = `700 ${size}px system-ui, sans-serif`;
      return context.measureText(value).width;
    },
  });
  context.font = `700 ${fitted.fontSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  const lines = fitted.lines;
  const lineHeight = fitted.lineHeight;
  const centerX = textBox
    ? (textBox.x + textBox.width / 2) * width
    : width / 2 + (clip.x ?? 0) * width / 2;
  const centerY = textBox
    ? (textBox.y + textBox.height / 2) * height
    : height * (0.83 - (clip.y ?? 0) * 0.45);
  const padding = Math.min(fitted.fontSize * 0.5, Math.max(4, maxWidth * 0.08));
  const measuredWidth = Math.max(...lines.map((value) => context.measureText(value).width), 0);
  const boxWidth = Math.min(maxWidth, measuredWidth + padding * 2);
  const boxHeight = Math.min(maxHeight, lines.length * lineHeight + padding * 2);
  const boundedCenterX = clamp(centerX, boxWidth / 2, width - boxWidth / 2);
  const boundedCenterY = clamp(centerY, boxHeight / 2, height - boxHeight / 2);
  context.fillStyle = `rgba(0, 0, 0, ${clamp(clip.captionBackgroundOpacity ?? (graphics && style.card ? 0.72 : graphics ? 0 : 0.68), 0, 1)})`;
  context.roundRect(boundedCenterX - boxWidth / 2, boundedCenterY - boxHeight / 2, boxWidth, boxHeight, fitted.fontSize * 0.3);
  context.fill();
  context.fillStyle = "#fff";
  lines.forEach((value, index) => {
    const lineY = boundedCenterY + (index - (lines.length - 1) / 2) * lineHeight;
    if (graphics && style.outline) {
      context.lineWidth = Math.max(2, Math.round(fontSize * 0.045));
      context.strokeStyle = "rgba(0, 0, 0, .9)";
      context.strokeText(value, boundedCenterX, lineY);
    }
    context.fillText(value, boundedCenterX, lineY);
  });
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
  // A clone project can contain a reference video with its original audio plus
  // explicit A1/A2 clips. In that case the video is a picture source only;
  // routing its embedded audio as well would duplicate the reference ambience.
  const hasIndependentAudio = state.clips.some((clip) =>
    (clip.track === "audio" || clip.track === "reference-audio") &&
    !state.disabledTracks?.includes(clip.track),
  );
  const canvasStream = canvas.captureStream(Math.max(1, Math.min(60, Math.round(state.fps || 30))));
  let audioContext: AudioContext | undefined;
  let audioDestination: MediaStreamAudioDestinationNode | undefined;
  const audioSources: MediaElementAudioSourceNode[] = [];
  const audioGains = new Map<string, GainNode>();
  if (typeof AudioContext !== "undefined" && mediaItems.some((item) => item.clip.track === "audio" || item.clip.track === "reference-audio" || item.clip.track === "video")) {
    audioContext = new AudioContext();
    audioDestination = audioContext.createMediaStreamDestination();
    for (const item of mediaItems) {
      if (hasIndependentAudio && item.clip.track === "video") continue;
      if (state.mutedTracks.includes(item.clip.track) || (item.clip.volume ?? 1) <= 0) continue;
      const mediaSource = audioContext.createMediaElementSource(item.element);
      const gain = audioContext.createGain();
      gain.gain.value = videoEditorAudioGain(state, item.clip, 0);
      mediaSource.connect(gain).connect(audioDestination);
      audioSources.push(mediaSource);
      audioGains.set(item.clip.id, gain);
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
      audioGains.get(item.clip.id)?.gain.setTargetAtTime(videoEditorAudioGain(state, item.clip, time), audioContext?.currentTime || 0, 0.025);
      if (media.paused) void media.play().catch(() => undefined);
    }
  };
  const draw = (time: number) => {
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const videoClips = state.clips.filter((clip) => clip.track === "video").sort((a, b) => a.start - b.start);
    const currentClip = videoClips.find((clip) => clipIsActive(clip, time));
    const currentItem = currentClip ? items.find((item) => item.clip.id === currentClip.id) : undefined;
    const previousClip = currentClip ? videoClips[videoClips.indexOf(currentClip) - 1] : undefined;
    const previousItem = previousClip ? items.find((item) => item.clip.id === previousClip.id) : undefined;
    drawLayoutBackdrop(context, currentClip?.layout, width, height);
    const transition = currentClip?.transitionIn;
    const progress = currentClip ? transitionProgress(currentClip, time) : 1;
    if (currentItem && previousItem && transition && transition !== "cut" && transition !== "none" && progress < 1) {
      if (!previousClip || !currentClip) return;
      const direction = transitionDirection(currentClip);
      // The previous frame is held at the end of its source while the new
      // shot enters; this mirrors the server's normalized transition output.
      drawVisualLayers(context, previousItem, width, height, {
        opacity: transition === "fade" || transition === "dissolve" ? 1 - progress : 1,
        motion: videoEditorMotionTransform(previousClip, previousClip.start + previousClip.duration),
      });
      if (transition === "wipe") drawVisualLayers(context, currentItem, width, height, { reveal: { direction, progress }, motion: videoEditorMotionTransform(currentClip, time) });
      else if (transition === "slide") drawVisualLayers(context, currentItem, width, height, { slide: { direction, progress }, motion: videoEditorMotionTransform(currentClip, time) });
      else drawVisualLayers(context, currentItem, width, height, { opacity: progress, motion: videoEditorMotionTransform(currentClip, time) });
    } else if (currentItem && currentClip) {
      drawVisualLayers(context, currentItem, width, height, { motion: videoEditorMotionTransform(currentClip, time) });
    }
    state.clips
      .filter((clip) => (clip.track === "caption" || clip.track === "graphics") && !state.disabledTracks?.includes(clip.track) && clipIsActive(clip, time))
      .forEach((clip) => drawCaption(context, clip, width, height, time));
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
    const blob = await writeWebmDuration(await result, durationSeconds);
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
