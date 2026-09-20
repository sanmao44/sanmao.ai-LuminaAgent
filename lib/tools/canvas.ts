import { defineTool, nativeToolId, TOOL_GATE } from "./registry";

/** Agent returns a patch; the browser remains the only place that applies it. */
export const canvasPatchTool = defineTool({
  id: nativeToolId("canvas_patch"),
  risk: "write",
  name: "canvas_patch",
  description: "在当前超级画布上提出一批结构化操作。只允许添加、更新、连接或删除节点；服务端不会直接修改画布，前端会校验后作为一次可撤销事务应用。",
  permissions: ["artifact:write"],
  tags: ["canvas"],
  source: "native",
  gating: TOOL_GATE.canvas,
  schema: {
    type: "object",
    properties: {
      version: { type: "integer", enum: [1] },
      runId: { type: "string" },
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 32,
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["add_node", "update_node", "connect", "remove_nodes"] },
            node: { type: "object" },
            id: { type: "string" },
            patch: { type: "object" },
            source: { type: "string" },
            target: { type: "string" },
            sourcePort: { type: "string", enum: ["left", "right"] },
            targetPort: { type: "string", enum: ["left", "right"] },
            kind: { type: "string", enum: ["manual", "generated", "variant", "lineage", "reference"] },
            inputRole: { type: "string" },
            order: { type: "number" },
            ids: { type: "array", items: { type: "string" } },
          },
          required: ["op"],
        },
      },
    },
    required: ["version", "operations"],
  },
});
