import type { CanvasNode } from "./types";

export type CanvasInputMode = "image" | "video" | "agent";

export type CanvasInputSemantics = {
  /** Image/video-producing nodes remain in their visible canvas order. */
  media: CanvasNode[];
  /** Only image-producing nodes can be sent to an image model or multimodal Agent. */
  imageReferences: CanvasNode[];
  /** Video-producing nodes are kept separate so they are never sent as images. */
  videoReferences: CanvasNode[];
  /** Prompt nodes become conversation/context text, never image references. */
  textContext: CanvasNode[];
  /** The first two image inputs have positional meaning in frame mode. */
  firstFrame?: CanvasNode;
  lastFrame?: CanvasNode;
  /** A video input is a dedicated video reference, not a still-image reference. */
  referenceVideo?: CanvasNode;
};

export function resolveCanvasInputSemantics(
  nodes: CanvasNode[],
  mode: CanvasInputMode,
  inputMode?: "text" | "first-frame" | "frames" | "reference",
): CanvasInputSemantics {
  const media = nodes.filter(
    (node) =>
      (node.type === "media" || node.type === "upscale") &&
      Boolean(node.data.kind) &&
      Boolean(node.data.url),
  );
  const imageReferences = media.filter(
    (node) => node.data.kind === "image",
  );
  const videoReferences = media.filter((node) => node.data.kind === "video");
  const textContext = nodes.filter(
    (node) => node.type === "prompt" && Boolean(String(node.data.text || "").trim()),
  );

  if (mode === "image" || mode === "agent") {
    return { media, imageReferences, videoReferences, textContext };
  }

  const firstFrame =
    inputMode === "first-frame" || inputMode === "frames"
      ? imageReferences[0]
      : undefined;
  const lastFrame = inputMode === "frames" ? imageReferences[1] : undefined;
  return {
    media,
    imageReferences,
    videoReferences,
    textContext,
    firstFrame,
    lastFrame,
    referenceVideo: videoReferences[0],
  };
}
