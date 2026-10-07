import { clone } from "./model";
import type { CanvasRuntimeState, CanvasGenerationParams, CanvasMediaKind } from "./types";
import {
  normalizeCreationSettings,
  readSharedCreationSettings,
  type AgentCreationSettings,
  type ImageCreationSettings,
  type VideoCreationSettings,
} from "../creation/settings";

type CanvasGenerationMode = CanvasGenerationParams["kind"];

export function defaultMediaParams(
  kind: CanvasMediaKind,
  runtime: CanvasRuntimeState | null,
): { params?: CanvasGenerationParams } {
  return kind === "audio" ? {} : { params: defaultCanvasGenerationParams(kind, runtime) };
}

export function defaultCanvasGenerationParams(
  kind: "image",
  runtime: CanvasRuntimeState | null,
): ImageCreationSettings;
export function defaultCanvasGenerationParams(
  kind: "video",
  runtime: CanvasRuntimeState | null,
): VideoCreationSettings;
export function defaultCanvasGenerationParams(
  kind: "text",
  runtime: CanvasRuntimeState | null,
): AgentCreationSettings;
export function defaultCanvasGenerationParams(
  kind: CanvasGenerationMode,
  runtime: CanvasRuntimeState | null,
): CanvasGenerationParams;
export function defaultCanvasGenerationParams(
  kind: CanvasGenerationMode,
  runtime: CanvasRuntimeState | null,
): CanvasGenerationParams {
  return readSharedCreationSettings(kind, runtime);
}

export function copyCanvasGenerationParams(
  value: unknown,
  kind: "image",
  runtime: CanvasRuntimeState | null,
): ImageCreationSettings;
export function copyCanvasGenerationParams(
  value: unknown,
  kind: "video",
  runtime: CanvasRuntimeState | null,
): VideoCreationSettings;
export function copyCanvasGenerationParams(
  value: unknown,
  kind: "text",
  runtime: CanvasRuntimeState | null,
): AgentCreationSettings;
export function copyCanvasGenerationParams(
  value: unknown,
  kind: CanvasGenerationMode,
  runtime: CanvasRuntimeState | null,
): CanvasGenerationParams;
export function copyCanvasGenerationParams(
  value: unknown,
  kind: CanvasGenerationMode,
  runtime: CanvasRuntimeState | null,
): CanvasGenerationParams {
  const source =
    value && typeof value === "object"
      ? clone(value as CanvasGenerationParams)
      : defaultCanvasGenerationParams(kind, runtime);
  return normalizeCreationSettings(kind, source, runtime);
}
