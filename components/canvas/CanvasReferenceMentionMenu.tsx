import type { CanvasDocument, CanvasNode } from "@/lib/canvas/types";
import ReferenceMentionMenu from "@/components/ReferenceMentionMenu";
import { canvasMentionOption } from "@/components/canvas/mention-options";

export type CanvasReferenceMentionMenuProps = {
  document: CanvasDocument;
  candidates: CanvasNode[];
  open: boolean;
  query?: string;
  onSelect: (index: number) => void;
  className: string;
};

export default function CanvasReferenceMentionMenu({
  document,
  candidates,
  open,
  query,
  onSelect,
  className,
}: CanvasReferenceMentionMenuProps) {
  return (
    <ReferenceMentionMenu
      references={candidates.map((node, index) => canvasMentionOption(document, node, index))}
      open={open}
      query={query}
      onSelect={onSelect}
      className={className}
    />
  );
}
