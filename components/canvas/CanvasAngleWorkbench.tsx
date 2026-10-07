"use client";

import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import AngleConsole, { type AngleConsoleDraft } from "@/components/AngleConsole";
import type { AngleGenerationInput, AngleCameraState, AngleOutputSpec } from "@/lib/angle-control";
import type { ClientReferenceImage, RegistryModel } from "@/lib/types";

export type CanvasAngleWorkbenchProps = {
  theme: "light" | "dark";
  reference: ClientReferenceImage | null;
  initialCamera?: AngleCameraState | null;
  initialCameraStart?: AngleCameraState | null;
  initialOutput?: AngleOutputSpec | null;
  initialNote?: string;
  models: RegistryModel[];
  busy: boolean;
  onReferenceFiles: (files: File[] | FileList) => void;
  onExit: () => void;
  onRemoveReference: () => void;
  onBrowseHistory: () => void;
  onGenerate: (input: AngleGenerationInput) => void | Promise<void>;
  onSaveAsNode?: (draft: AngleConsoleDraft) => void;
  onNotify: (message: string) => void;
  onDraftChange?: (draft: AngleConsoleDraft) => void;
};

export default function CanvasAngleWorkbench({
  theme,
  reference,
  initialCamera,
  initialCameraStart,
  initialOutput,
  initialNote,
  models,
  busy,
  onReferenceFiles,
  onExit,
  onRemoveReference,
  onBrowseHistory,
  onGenerate,
  onSaveAsNode,
  onNotify,
  onDraftChange,
}: CanvasAngleWorkbenchProps) {
  const stopPropagation = (event: ReactPointerEvent | ReactWheelEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      className="canvas-angle-workbench"
      data-canvas-wheel-isolate
      onPointerDown={stopPropagation}
      onPointerMove={stopPropagation}
      onPointerUp={stopPropagation}
      onPointerCancel={stopPropagation}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onWheel={stopPropagation}
    >
      <AngleConsole
        theme={theme}
        embedded
        reference={reference}
        initialCamera={initialCamera}
        initialCameraStart={initialCameraStart}
        initialOutput={initialOutput}
        initialNote={initialNote}
        models={models}
        results={[]}
        busy={busy}
        onReferenceFiles={onReferenceFiles}
        onExit={onExit}
        onRemoveReference={onRemoveReference}
        onBrowseHistory={onBrowseHistory}
        onGenerate={onGenerate}
        onSaveAsNode={onSaveAsNode}
        onOpenResult={() => undefined}
        onDownloadResult={() => undefined}
        onDownloadShare={() => undefined}
        onNotify={onNotify}
        onDraftChange={onDraftChange}
      />
    </div>
  );
}
