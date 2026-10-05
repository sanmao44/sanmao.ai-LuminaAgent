"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { CanvasVideoClipState } from "@/lib/canvas/types";

export type CanvasMediaLoadMessage = "missing" | "temporary";
export type CanvasVideoPlaybackState = "paused" | "playing" | "ended";

type CanvasMediaPlaybackOptions = {
  url?: string;
  videoClip?: CanvasVideoClipState;
};

/** Owns transient browser media state without becoming a CanvasCore owner. */
export function useCanvasMediaPlayback({
  url,
  videoClip,
}: CanvasMediaPlaybackOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [mediaLoadMessage, setMediaLoadMessage] =
    useState<CanvasMediaLoadMessage>("temporary");
  const mediaRetryAttemptRef = useRef(0);
  const mediaRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mediaRetryKey, setMediaRetryKey] = useState(0);
  const [videoPlaybackState, setVideoPlaybackState] =
    useState<CanvasVideoPlaybackState>("paused");

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      try {
        video.currentTime = videoClip?.startTime || 0;
      } catch {
        // The media element may be replaced while metadata is loading.
      }
    }
    setVideoPlaybackState("paused");
    if (mediaRetryTimerRef.current) {
      clearTimeout(mediaRetryTimerRef.current);
    }
    mediaRetryAttemptRef.current = 0;
    setMediaUnavailable(false);
    setMediaLoadMessage("temporary");
  }, [url, videoClip?.startTime]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoClip) return;
    video.playbackRate = videoClip.playbackRate;
    video.volume = videoClip.muted ? 0 : videoClip.volume;
  }, [videoClip?.muted, videoClip?.playbackRate, videoClip?.volume]);

  useEffect(
    () => () => {
      if (mediaRetryTimerRef.current) {
        clearTimeout(mediaRetryTimerRef.current);
      }
    },
    [],
  );

  const handleMediaError = useCallback(() => {
    const attempt = mediaRetryAttemptRef.current;
    if (attempt < 2) {
      mediaRetryAttemptRef.current = attempt + 1;
      mediaRetryTimerRef.current = setTimeout(() => {
        setMediaUnavailable(false);
        setMediaRetryKey((value) => value + 1);
      }, 500 * (attempt + 1));
      return;
    }
    void fetch(String(url), {
      cache: "no-store",
      headers: { Range: "bytes=0-1" },
    })
      .then((response) => {
        setMediaLoadMessage(
          response.status === 404 || response.status === 400
            ? "missing"
            : "temporary",
        );
        setMediaUnavailable(true);
      })
      .catch(() => {
        setMediaLoadMessage("temporary");
        setMediaUnavailable(true);
      });
  }, [url]);

  const retryMediaLoad = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (mediaRetryTimerRef.current) {
        clearTimeout(mediaRetryTimerRef.current);
      }
      mediaRetryAttemptRef.current = 0;
      setMediaUnavailable(false);
      setMediaLoadMessage("temporary");
      setMediaRetryKey((value) => value + 1);
    },
    [],
  );

  const toggleVideoPlayback = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const video = videoRef.current;
      if (!video) return;

      if (
        video.ended ||
        (videoClip && video.currentTime >= videoClip.endTime - 0.01)
      ) {
        video.currentTime = videoClip?.startTime || 0;
      }
      if (video.paused) {
        void video.play().catch(() => setVideoPlaybackState("paused"));
      } else {
        video.pause();
      }
    },
    [videoClip],
  );

  return {
    videoRef,
    mediaUnavailable,
    mediaLoadMessage,
    mediaRetryKey,
    videoPlaybackState,
    setVideoPlaybackState,
    handleMediaError,
    retryMediaLoad,
    toggleVideoPlayback,
  };
}
