export type ProvenanceRelation =
  | "generated_from"
  | "edited_from"
  | "upscaled_from"
  | "referenced"
  | "converted_to_video"
  | "derived_from";

export type ProvenanceEdge = {
  id: string;
  fromId: string;
  toId: string;
  relation: ProvenanceRelation;
  taskId?: string;
  projectId?: string;
  chatId?: string;
  canvasId?: string;
  nodeId?: string;
};

export type ProvenanceEdgeDraft = Omit<ProvenanceEdge, "id" | "toId">;
