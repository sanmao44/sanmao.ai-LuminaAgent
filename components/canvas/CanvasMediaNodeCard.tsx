"use client";

import type {
  CanvasMaskState,
  CanvasNode,
  CanvasVideoClipState,
} from "@/lib/canvas/types";
import { canvasMaskStatusLabel } from "@/lib/canvas/mask";
import { formatCanvasAudioDuration } from "@/lib/canvas/media";
import CanvasAudioPlayer from "@/components/canvas/CanvasAudioPlayer";
import CanvasProcessingIndicator, {
  type CanvasProcessingKind,
} from "@/components/canvas/CanvasProcessingIndicator";
import { useCanvasMediaPlayback } from "@/components/canvas/useCanvasMediaPlayback";

export type CanvasMediaNodeCardProps = {
  node: CanvasNode;
  pending: boolean;
  failed: boolean;
  processingLabel: string;
  processingProgress?: number;
  processingKind: CanvasProcessingKind;
  imageResolution: string | null;
  videoResolution: string | null;
  videoDuration: string;
  videoClip?: CanvasVideoClipState;
  mediaFooterStatus: string;
  maskState?: CanvasMaskState;
  onNaturalSize: (
    nodeId: string,
    width: number,
    height: number,
    durationSeconds?: number,
  ) => void;
  onLocalEdit: () => void;
};

export default function CanvasMediaNodeCard({
  node,
  pending,
  failed,
  processingLabel,
  processingProgress,
  processingKind,
  imageResolution,
  videoResolution,
  videoDuration,
  videoClip,
  mediaFooterStatus,
  maskState,
  onNaturalSize,
  onLocalEdit,
}: CanvasMediaNodeCardProps) {
  const data = node.data;
  const {
    videoRef,
    mediaUnavailable,
    mediaLoadMessage,
    mediaRetryKey,
    videoPlaybackState,
    setVideoPlaybackState,
    handleMediaError,
    retryMediaLoad,
    toggleVideoPlayback,
  } = useCanvasMediaPlayback({ url: data.url, videoClip });
  const videoIsPlaying = videoPlaybackState === "playing";
  const videoHasEnded = videoPlaybackState === "ended";
  const videoControlLabel = videoIsPlaying
    ? "\u6682\u505c\u89c6\u9891"
    : videoHasEnded
      ? "\u91cd\u65b0\u64ad\u653e\u89c6\u9891"
      : "\u64ad\u653e\u89c6\u9891";

  return (
        <div className={`canvas-media-card${data.kind === "video" ? " video" : data.kind === "audio" ? " audio" : ""}`}>
          <div className="canvas-media-stage">
            {pending ? (
              <div className="canvas-media-state pending">
                <CanvasProcessingIndicator
                  label={processingLabel}
                  progress={processingProgress}
                  kind={processingKind}
                  startedAt={
                    data.processingStartedAt || data.generation?.createdAt
                  }
                  waiting={data.status === "queued"}
                  compact
                />
              </div>
            ) : failed ? (
              <div className="canvas-media-state failed">
                <span>!</span>
                <b>生成失败</b>
                <small>{data.statusLabel}</small>
              </div>
            ) : !data.url ? (
              <div className="canvas-media-state draft">
                <span>{data.kind === "video" ? "▶" : data.kind === "audio" ? "♫" : "▣"}</span>
                <b>{data.kind === "video" ? "空视频节点" : data.kind === "audio" ? "空音频节点" : "空图片节点"}</b>
                 <small>{data.kind === "audio" ? "等待导入音频" : "选中后在下方生成"}</small>
              </div>
            ) : mediaUnavailable ? (
              <div className={`canvas-media-state ${mediaLoadMessage === "missing" ? "missing" : "temporary"}`}>
                <span>!</span>
                <b>{mediaLoadMessage === "missing" ? "素材文件已丢失" : "素材暂时无法加载"}</b>
                <small>{mediaLoadMessage === "missing" ? "文件不在媒体库中，可重新生成或上传替换" : "可能是服务暂时重启或网络波动，原视频不会被删除"}</small>
                <button
                  type="button"
                  className="canvas-media-retry"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={retryMediaLoad}
                >
                  重试加载
                </button>
              </div>
            ) : data.kind === "video" ? (
              <video
                key={mediaRetryKey}
                ref={videoRef}
                src={data.url}
                muted={videoClip ? videoClip.muted : true}
                playsInline
                preload="metadata"
                draggable={false}
                onError={handleMediaError}
                style={videoClip ? { objectFit: videoClip.fit, transform: `translate(${(videoClip.x || 0) * 50}%, ${(videoClip.y || 0) * 50}%) scale(${videoClip.scale || 1})`, opacity: videoClip.opacity ?? 1, transformOrigin: "center center" } : undefined}
                aria-label={`视频预览${videoDuration ? `，时长 ${videoDuration}` : ""}`}
                onPlay={() => setVideoPlaybackState("playing")}
                onPause={() =>
                  setVideoPlaybackState((current) =>
                    current === "ended" ? current : "paused",
                  )
                }
                onEnded={() => setVideoPlaybackState("ended")}
                onTimeUpdate={(event) => {
                  if (!videoClip || event.currentTarget.currentTime < videoClip.endTime - 0.01) return;
                  setVideoPlaybackState("ended");
                  event.currentTarget.pause();
                  event.currentTarget.currentTime = videoClip.endTime;
                }}
                onLoadedMetadata={(event) => {
                  onNaturalSize(
                    node.id,
                    event.currentTarget.videoWidth,
                    event.currentTarget.videoHeight,
                    event.currentTarget.duration,
                  );
                  if (videoClip) event.currentTarget.currentTime = videoClip.startTime;
                }}
              />
            ) : data.kind === "audio" ? (
              <div className="canvas-audio-stage">
                <div className="canvas-audio-visual">
                  <span className="canvas-audio-icon" aria-hidden="true">♫</span>
                  <div>
                    <b>参考音频</b>
                    <small>连接到视频节点</small>
                  </div>
                </div>
                <CanvasAudioPlayer
                  src={String(data.url)}
                  name={String(data.name || "音频素材")}
                  compact
                  onDuration={(duration) => onNaturalSize(node.id, 0, 0, duration)}
                />
                <span className="canvas-audio-mark">♫ 音频节点</span>
              </div>
            ) : (
              <img
                key={mediaRetryKey}
                src={data.url}
                alt={data.name || "画布素材"}
                draggable={false}
                onError={handleMediaError}
                onLoad={(event) =>
                  onNaturalSize(
                    node.id,
                    event.currentTarget.naturalWidth,
                    event.currentTarget.naturalHeight,
                  )
                }
              />
            )}
            {data.kind === "video" && data.url && !mediaUnavailable && (
              <button
                type="button"
                className={`canvas-video-play${videoIsPlaying ? " is-playing" : ""}${videoHasEnded ? " is-ended" : ""}`}
                title={videoControlLabel}
                aria-label={`${videoControlLabel}${videoDuration ? `，时长 ${videoDuration}` : ""}`}
                aria-pressed={videoIsPlaying}
                onPointerDown={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onClick={toggleVideoPlayback}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {videoIsPlaying ? (
                    <path d="M7 6.5A1.5 1.5 0 0 1 8.5 5h1A1.5 1.5 0 0 1 11 6.5v11A1.5 1.5 0 0 1 9.5 19h-1A1.5 1.5 0 0 1 7 17.5v-11Zm6 0A1.5 1.5 0 0 1 14.5 5h1A1.5 1.5 0 0 1 17 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-1a1.5 1.5 0 0 1-1.5-1.5v-11Z" />
                  ) : videoHasEnded ? (
                    <path d="M12 4a8 8 0 1 0 7.75 10h-2.08A6 6 0 1 1 12 6c1.43 0 2.74.5 3.77 1.34L13.5 9.6H20V3.1l-2.77 2.77A9.96 9.96 0 0 0 12 4Z" />
                  ) : (
                    <path d="M9 6.8v10.4a1 1 0 0 0 1.53.85l7.78-5.2a1 1 0 0 0 0-1.7l-7.78-5.2A1 1 0 0 0 9 6.8Z" />
                  )}
                </svg>
              </button>
            )}
            {data.kind === "video" && data.url && (
              <span
                className="canvas-video-mark"
                title={`视频${videoDuration ? ` · ${videoDuration}` : ""}`}
                aria-label={`视频${videoDuration ? `，时长 ${videoDuration}` : ""}`}
              >
                ▶ 视频{videoDuration ? ` · ${videoDuration}` : ""}
              </span>
            )}
            {imageResolution && (
              <span
                className="canvas-image-resolution"
                title={`图片分辨率 ${imageResolution}`}
                aria-label={`图片分辨率 ${imageResolution}`}
              >
                {imageResolution}
              </span>
            )}
            {videoResolution && (
              <span
                className="canvas-image-resolution canvas-video-resolution"
                title={`视频分辨率 ${videoResolution}`}
                aria-label={`视频分辨率 ${videoResolution}`}
              >
                {videoResolution}
              </span>
            )}
            {data.url && (
              <span
                className="canvas-node-asset-drag-handle"
                role="button"
                tabIndex={0}
                draggable
                aria-label="拖到资产中心归类"
                title="拖到资产中心归类"
                onPointerDown={(event) => event.stopPropagation()}
                onDragStart={(event) => {
                  event.stopPropagation();
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData(
                    "application/x-sanmao-canvas-node",
                    node.id,
                  );
                }}
              >
                ↗
              </span>
            )}
            {data.url && data.maskApplied && (
              <span className="canvas-node-mask-badge used" title="本次生成请求使用了局部编辑">
                ◌ 本次使用局部编辑
              </span>
            )}
            {data.url && maskState && !data.maskApplied && (
              <button
                type="button"
                className={`canvas-node-mask-badge ${maskState.status}`}
                title={`局部编辑 · ${canvasMaskStatusLabel(maskState.status)} · 点击查看或继续编辑`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onLocalEdit();
                }}
              >
                ◌ 局部编辑 · {canvasMaskStatusLabel(maskState.status)}
              </button>
            )}
          </div>
          <div className="canvas-node-footer">
            <span className="canvas-type-icon">
              {data.kind === "video" ? "▶" : data.kind === "audio" ? "♫" : "▣"}
            </span>
            <span className="canvas-node-title">
              <b>{data.name || (data.kind === "video" ? "视频素材" : data.kind === "audio" ? "音频素材" : "素材")}</b>
              <small>{data.model || (data.kind === "video" ? "视频" : data.kind === "audio" ? `${data.mimeType || "音频"}${data.durationMs ? ` · ${formatCanvasAudioDuration(data.durationMs)}` : ""}` : mediaFooterStatus)}</small>
            </span>
            <em className={data.kind === "video" ? "video-status" : data.kind === "audio" ? "audio-status" : undefined}>
              {data.kind === "audio" && data.url ? "已就绪" : mediaFooterStatus}
            </em>
          </div>
        </div>
  );
}
