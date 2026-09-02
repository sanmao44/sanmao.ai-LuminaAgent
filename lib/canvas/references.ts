import type { CanvasInputRole, CanvasNode } from "./types";

export type CanvasInputMode = "image" | "video" | "agent";
export type CanvasVideoInputMode = "text" | "first-frame" | "frames" | "reference";

export type CanvasVideoInputCapabilities = {
  supportsReference?: boolean;
  supportsFirstFrame?: boolean;
  /** Some registries publish a dedicated two-frame capability. */
  supportsFrames?: boolean;
  supportsAudio?: boolean;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxAudios?: number;
};

export type CanvasInputSemantics = {
  /** Media-producing nodes remain in their visible canvas order. */
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
  /** All video inputs, retained for multi-video providers. */
  referenceVideos: CanvasNode[];
  /** Audio-producing nodes are never sent to image models or Agents. */
  audioReferences: CanvasNode[];
};

export type CanvasVideoInputs = {
  /** All usable media inputs, kept in the canvas/reference order. */
  media: CanvasNode[];
  /** All still-image inputs before mode-specific slot assignment. */
  orderedImages: CanvasNode[];
  /** Images actually submitted as reference images in the selected mode. */
  referenceImages: CanvasNode[];
  /** The image assigned to the first-frame slot, when the mode uses it. */
  firstFrame?: CanvasNode;
  /** The image assigned to the last-frame slot, when the mode uses it. */
  lastFrame?: CanvasNode;
  /** The first connected video input, kept separate from still images. */
  referenceVideo?: CanvasNode;
  /** All connected video inputs that will be submitted, in canvas order. */
  referenceVideos: CanvasNode[];
  /** Audio inputs actually submitted with the video request. */
  audios: CanvasNode[];
  /** All connected audio inputs before mode/capability filtering. */
  orderedAudios: CanvasNode[];
  /** Inputs that remain connected but will not be submitted this time. */
  unused: CanvasNode[];
  /** Alias used by canvas UI and callers that need to explain ignored inputs. */
  unusedInputs: CanvasNode[];
};

function isMediaNode(node: CanvasNode) {
  return (
    (node.type === "media" || node.type === "upscale") &&
    Boolean(node.data.kind) &&
    Boolean(node.data.url)
  );
}

/** A connected still image makes a video media card an in-place generation target. */
export function shouldGenerateVideoInPlace(
  target: CanvasNode | undefined,
  references: readonly CanvasNode[],
) {
  return target?.type === "media" &&
    target.data.kind === "video" &&
    references.some((node) => isMediaNode(node) && node.data.kind === "image");
}

function videoKind(node: CanvasNode) {
  return node.type === "media" || node.type === "upscale"
    ? node.data.kind
    : undefined;
}

function capabilityValue(
  capabilities: ReadonlyArray<string> | CanvasVideoInputCapabilities,
  name: "reference" | "first-frame",
) {
  if (typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities)) {
    const inputCapabilities = capabilities as CanvasVideoInputCapabilities;
    return name === "reference"
      ? Boolean(inputCapabilities.supportsReference)
      : Boolean(inputCapabilities.supportsFirstFrame);
  }
  return (capabilities as ReadonlyArray<string>).includes(name === "reference" ? "video-reference" : "video-first-frame");
}

/** Pick the least surprising automatic mode for a newly connected image. */
export function preferredCanvasVideoInputMode(
  capabilities: ReadonlyArray<string> | CanvasVideoInputCapabilities,
): Exclude<CanvasVideoInputMode, "text" | "frames"> | undefined {
  if (capabilityValue(capabilities, "reference")) return "reference";
  if (capabilityValue(capabilities, "first-frame")) return "first-frame";
  return undefined;
}

/**
 * Pick the automatic video input mode from the number of connected stills.
 * The returned mode never silently discards an image: callers should keep the
 * connection and surface a limit/capability warning when the chosen mode
 * cannot submit every connected image.
 */
export function preferredCanvasVideoInputModeForImageCount(
  imageCount: number,
  capabilities: ReadonlyArray<string> | CanvasVideoInputCapabilities,
): CanvasVideoInputMode | undefined {
  const count = Math.max(0, Math.floor(Number(imageCount) || 0));
  if (count === 0) return undefined;

  const supportsReference = capabilityValue(capabilities, "reference");
  const supportsFirstFrame = capabilityValue(capabilities, "first-frame");
  const supportsFrames = typeof capabilities === "object" && capabilities !== null && !Array.isArray(capabilities)
    ? Boolean((capabilities as CanvasVideoInputCapabilities).supportsFrames ?? supportsFirstFrame)
    : supportsFirstFrame;

  if (count === 1) {
    if (supportsFirstFrame) return "first-frame";
    if (supportsReference) return "reference";
    return undefined;
  }
  if (count === 2) {
    if (supportsFrames) return "frames";
    if (supportsReference) return "reference";
    return undefined;
  }
  return supportsReference ? "reference" : undefined;
}

/** Infer the persisted role for a normal/legacy edge from its endpoints. */
export function inferCanvasInputRole(
  source: CanvasNode,
  target: CanvasNode,
  inputMode?: CanvasVideoInputMode,
  position = 0,
): CanvasInputRole | undefined {
  if (source.type === "prompt" || source.type === "generator") return "context";
  const sourceKind = videoKind(source);
  const targetKind = videoKind(target);
  if (!sourceKind || !targetKind) return undefined;
  if (sourceKind === "audio") return targetKind === "video" ? "audio" : undefined;
  if (targetKind === "image") {
    return sourceKind === "video" ? "video" : "reference-image";
  }
  if (sourceKind === "video") return "video";
  if (inputMode === "frames") {
    return position === 0 ? "first-frame" : position === 1 ? "last-frame" : "reference-image";
  }
  if (inputMode === "first-frame") return position === 0 ? "first-frame" : "reference-image";
  return "reference-image";
}

function roleOf(
  roles: ReadonlyMap<string, CanvasInputRole | undefined> | undefined,
  node: CanvasNode,
) {
  return roles?.get(node.id);
}

function uniqueNodes(nodes: CanvasNode[]) {
  return [...new Map(nodes.filter(isMediaNode).map((node) => [node.id, node])).values()];
}

/**
 * Resolve one video request's actual image/video inputs. The selected mode is
 * authoritative; persisted edge roles are used to keep explicit frame slots
 * stable, while untyped/legacy inputs fill the first available slot.
 */
export function resolveCanvasVideoInputs(
  nodes: CanvasNode[],
  inputMode: CanvasVideoInputMode = "text",
  roles?: ReadonlyMap<string, CanvasInputRole | undefined>,
  options: CanvasVideoInputCapabilities = {},
): CanvasVideoInputs {
  const media = uniqueNodes(nodes);
  const orderedImages = media.filter((node) => videoKind(node) === "image");
  const videos = media.filter((node) => videoKind(node) === "video");
  const orderedAudios = media.filter((node) => videoKind(node) === "audio");
  const unused: CanvasNode[] = [];
  const used = new Set<string>();
  const mark = (node: CanvasNode | undefined) => {
    if (node) used.add(node.id);
    return node;
  };
  const explicit = (role: CanvasInputRole) =>
    orderedImages.find((node) => roleOf(roles, node) === role && !used.has(node.id));
  const unassigned = () => orderedImages.find((node) => !used.has(node.id));

  let firstFrame: CanvasNode | undefined;
  let lastFrame: CanvasNode | undefined;
  let referenceImages: CanvasNode[] = [];

  if (inputMode === "reference") {
    const limit = Math.max(0, Math.floor(options.maxReferenceImages ?? 16));
    referenceImages = orderedImages.slice(0, limit).map(mark).filter(Boolean) as CanvasNode[];
  } else if (inputMode === "first-frame") {
    firstFrame = mark(explicit("first-frame") || unassigned());
  } else if (inputMode === "frames") {
    firstFrame = mark(explicit("first-frame"));
    lastFrame = mark(explicit("last-frame"));
    if (!firstFrame) firstFrame = mark(unassigned());
    if (!lastFrame) lastFrame = mark(unassigned());
  }

  orderedImages.forEach((node) => {
    if (!used.has(node.id)) unused.push(node);
  });
  if (inputMode === "text") unused.splice(0, unused.length, ...orderedImages);
  const referenceVideo = inputMode === "text" ? undefined : videos[0];
  const videoLimit = Math.max(0, Math.floor(options.maxReferenceVideos ?? 10));
  const referenceVideos = inputMode === "text" ? [] : videos.slice(0, videoLimit);
  if (inputMode === "text") unused.push(...videos);
  else if (videos.length > referenceVideos.length) unused.push(...videos.slice(referenceVideos.length));
  const audioLimit = Math.max(0, Math.floor(options.maxAudios ?? 10));
  const audios = inputMode === "text" || options.supportsAudio === false
    ? []
    : orderedAudios.slice(0, audioLimit);
  if (inputMode === "text" || options.supportsAudio === false) unused.push(...orderedAudios);
  else if (orderedAudios.length > audios.length) unused.push(...orderedAudios.slice(audios.length));

  return {
    media,
    orderedImages,
    referenceImages,
    firstFrame,
    lastFrame,
    referenceVideo,
    referenceVideos,
    audios,
    orderedAudios,
    unused,
    unusedInputs: unused,
  };
}

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
  const audioReferences = media.filter((node) => node.data.kind === "audio");
  const textContext = nodes.filter(
    (node) => node.type === "prompt" && Boolean(String(node.data.text || "").trim()),
  );

  if (mode === "image" || mode === "agent") {
    return { media, imageReferences, videoReferences, referenceVideos: videoReferences, audioReferences, textContext };
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
    referenceVideos: videoReferences,
    audioReferences,
  };
}
