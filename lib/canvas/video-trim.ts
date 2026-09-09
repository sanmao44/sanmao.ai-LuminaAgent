import type { CanvasVideoClipState } from "./types";

export type RenderedCanvasVideoClip = {
  blob: Blob;
  mime: string;
  durationSeconds: number;
  width: number;
  height: number;
};

type CapturableVideoElement = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  webkitCaptureStream?: () => MediaStream;
};

function supportedRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  return [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ].find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function waitForVideoEvent(video: HTMLVideoElement, eventName: string) {
  return new Promise<void>((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("无法读取视频媒体数据"));
    };
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

/**
 * Render a real, playable WebM file from a selected source range. This is
 * intentionally browser-side so the canvas can create a clipped asset without
 * adding an ffmpeg runtime to the desktop app.
 */
export async function renderCanvasVideoClip(
  sourceUrl: string,
  clip: Pick<CanvasVideoClipState, "startTime" | "endTime" | "playbackRate" | "muted">,
): Promise<RenderedCanvasVideoClip> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("当前浏览器不支持视频裁剪，请使用 Chromium 内核浏览器。");
  }
  const mime = supportedRecorderMime();
  if (!mime) throw new Error("当前浏览器不支持 WebM 视频导出。");

  const video = document.createElement("video") as CapturableVideoElement;
  video.preload = "auto";
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = sourceUrl;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | undefined;
  let timeoutId: number | undefined;
  const stopTracks = () => stream?.getTracks().forEach((track) => track.stop());
  const cleanupVideo = () => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    video.pause();
    video.removeAttribute("src");
    video.load();
    stopTracks();
  };

  try {
    await waitForVideoEvent(video, "loadedmetadata");
    const duration = Number(video.duration);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取视频时长。");
    const start = Math.max(0, Math.min(duration, Number(clip.startTime) || 0));
    const end = Math.max(start + 0.05, Math.min(duration, Number(clip.endTime) || duration));
    if (end <= start) throw new Error("剪辑范围无效，请重新调整时间轴。");

    const capture = video.captureStream || video.webkitCaptureStream;
    if (!capture) throw new Error("当前浏览器不支持实时视频导出，请使用最新版 Chrome 或 Edge。");
    try {
      stream = capture.call(video);
    } catch {
      throw new Error("当前视频无法被浏览器捕获，请先将视频重新导入画布后再裁剪。");
    }
    if (!stream.getVideoTracks().length) throw new Error("无法捕获视频画面，请重新加载素材后重试。");

    // Start muted to satisfy autoplay policies after the metadata await, then
    // restore the requested mute state once playback has started.
    video.muted = true;
    video.playbackRate = clip.playbackRate;
    const seeked = Math.abs(video.currentTime - start) < 0.001
      ? Promise.resolve()
      : waitForVideoEvent(video, "seeked");
    video.currentTime = start;
    await seeked;

    const chunks: Blob[] = [];
    const finished = new Promise<Blob>((resolve, reject) => {
      const nextRecorder = new MediaRecorder(stream as MediaStream, { mimeType: mime });
      recorder = nextRecorder;
      nextRecorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      nextRecorder.addEventListener("error", () => reject(new Error("视频导出失败，请重试。")), { once: true });
      nextRecorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: mime })), { once: true });
      const finish = () => {
        video.pause();
        if (nextRecorder.state !== "inactive") nextRecorder.stop();
      };
      const onTimeUpdate = () => {
        if (video.currentTime >= end - 0.02) finish();
      };
      const onEnded = () => finish();
      video.addEventListener("timeupdate", onTimeUpdate);
      video.addEventListener("ended", onEnded, { once: true });
      nextRecorder.addEventListener("stop", () => {
        video.removeEventListener("timeupdate", onTimeUpdate);
        video.removeEventListener("ended", onEnded);
      }, { once: true });
    });

    const activeRecorder = recorder;
    if (!activeRecorder) throw new Error("视频导出初始化失败，请重试。");
    activeRecorder.start(250);
    await video.play();
    video.muted = clip.muted;
    timeoutId = window.setTimeout(() => {
      video.pause();
      if (activeRecorder.state !== "inactive") activeRecorder.stop();
    }, Math.max(15000, ((end - start) / clip.playbackRate) * 1000 + 10000));
    const blob = await finished;
    return {
      blob,
      mime,
      durationSeconds: (end - start) / clip.playbackRate,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    if (recorder && recorder.state !== "inactive") recorder.stop();
    cleanupVideo();
  }
}
