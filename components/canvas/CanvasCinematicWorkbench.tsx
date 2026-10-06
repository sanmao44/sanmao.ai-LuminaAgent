"use client";

import OneClickCinematicPanel, {
  type OneClickCinematicVideoSelection,
} from "@/components/canvas/OneClickCinematicPanel";
import type { CinematicOpeningSettings } from "@/lib/cinematic-shock-opening-director";
import type { CanvasRuntimeState } from "@/lib/canvas/types";

export type { OneClickCinematicVideoSelection } from "@/components/canvas/OneClickCinematicPanel";

export type CanvasCinematicWorkbenchProps = {
  imageUrl: string;
  imageName?: string;
  runtime: CanvasRuntimeState | null;
  onCancel: () => void;
  onSubmit: (
    settings: CinematicOpeningSettings,
    selection: OneClickCinematicVideoSelection,
  ) => void;
};

export default function CanvasCinematicWorkbench({
  imageUrl,
  imageName,
  runtime,
  onCancel,
  onSubmit,
}: CanvasCinematicWorkbenchProps) {
  return (
    <OneClickCinematicPanel
      imageUrl={imageUrl}
      imageName={imageName}
      runtime={runtime}
      onCancel={onCancel}
      onSubmit={onSubmit}
    />
  );
}
