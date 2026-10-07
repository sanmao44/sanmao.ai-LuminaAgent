export type CanvasPatchOperation =
  | { op: 'add_node'; node: Record<string, unknown> }
  | { op: 'update_node'; id: string; patch: Record<string, unknown> }
  | { op: 'connect'; source: string; target: string; sourcePort?: string; targetPort?: string; kind?: string; inputRole?: string; order?: number }
  | { op: 'remove_nodes'; ids: string[] };

export type CanvasPatch = {
  version: 1;
  runId?: string;
  operations: CanvasPatchOperation[];
};
