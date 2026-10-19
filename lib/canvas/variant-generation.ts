import type { CanvasDocument, CanvasNode } from "./types";
import {
  incomingContext,
  isCanvasMentionableNode,
  isCanvasReferenceableNode,
  smartPrompt,
} from "./model";
import { createCanvasReferenceDraft } from "./reference-drafts";
import { resolveCanvasMentionTokens } from "./mention-resolution";
import { canvasImageRequestOperation, prepareCanvasImageReferenceRequest, type CanvasImageReferenceRequest } from "./image-reference-request";
import {
  replaceNaturalReferenceLabels,
  selectCreativeReferences,
} from "../creative-references";
import type { CanvasReferenceDraft } from "./reuse";
import type { ImageCreationSettings } from "../creation/settings";

export type CanvasVariantGenerationPreparation = {
  linkedNodes: CanvasNode[];
  imageReferences: { url: string; name: string }[];
  prompts: string[];
  invalidNumbers: number[];
  imageRequests?: CanvasImageReferenceRequest[];
};

export type PrepareCanvasVariantGenerationInput = {
  document: CanvasDocument;
  generator: CanvasNode;
  requirements: readonly string[];
  mentionCandidates: readonly CanvasNode[];
  imageParams?: ImageCreationSettings;
};

/**
 * Prepare read-only inputs for a variant generation batch.
 * CanvasWorkspace remains the owner of task lifecycle, API calls, and document mutations.
 */
export function prepareCanvasVariantGeneration(
  input: PrepareCanvasVariantGenerationInput,
): CanvasVariantGenerationPreparation {
  const incoming = incomingContext(input.document, input.generator.id);
  const candidateSource = input.mentionCandidates.length
    ? input.mentionCandidates
    : incoming;
  const candidateNodes = candidateSource.filter(
    (node) => node.id !== input.generator.id && isCanvasMentionableNode(node),
  );
  const candidateReferences = candidateNodes
    .map((node) => createCanvasReferenceDraft(node))
    .filter((reference): reference is CanvasReferenceDraft => Boolean(reference));
  const commonPrompt = String(input.generator.data.prompt || "").trim();
  const naturalCommonPrompt = replaceNaturalReferenceLabels(
    commonPrompt,
    candidateReferences,
  );
  const naturalRequirements = input.requirements.map((requirement) =>
    replaceNaturalReferenceLabels(requirement, candidateReferences),
  );
  const selection = selectCreativeReferences(
    [
      naturalCommonPrompt.value,
      ...naturalRequirements.map((result) => result.value),
    ].join("\n"),
    candidateReferences,
  );
  const selectedNodeIds = new Set(
    selection.references.map((reference) => reference.nodeId || reference.id),
  );
  const inputNodes = selection.hasMentions
    ? candidateNodes.filter((node) => selectedNodeIds.has(node.id))
    : incoming;
  const linkedNodes = [
    ...new Map(
      inputNodes
        .filter((node) => isCanvasReferenceableNode(node))
        .map((node) => [node.id, node]),
    ).values(),
  ];
  const contextNodes = inputNodes.filter((node) => node.type === "prompt");
  const imageReferences = linkedNodes
    .filter((node) => node.data.kind === "image")
    .map((node) => ({
      url: String(node.data.url || ""),
      name: String(node.data.name || "\u53c2\u8003\u7d20\u6750"),
    }))
    .filter((reference) => reference.url);
  const imageParams = input.imageParams;
  const imageRequests = imageParams
    ? input.requirements.map((requirement) =>
        prepareCanvasImageReferenceRequest({
          prompt: [commonPrompt, requirement.trim()].filter(Boolean).join("\n"),
          references: candidateReferences,
          defaultReferences: incoming
            .map((node) => createCanvasReferenceDraft(node))
            .filter((reference): reference is CanvasReferenceDraft => Boolean(reference)),
          params: imageParams,
          imageOperation: canvasImageRequestOperation(imageParams),
        }),
      )
    : undefined;
  const prompts = naturalRequirements.map((requirement) => {
    const instruction = requirement.value || "";
    return smartPrompt(
      resolveCanvasMentionTokens(
        [
          naturalCommonPrompt.value,
          instruction ? `\u53d8\u4f53\u8981\u6c42\uff1a${instruction}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        candidateNodes,
      ),
      contextNodes,
    );
  });

  return {
    linkedNodes: [...linkedNodes],
    imageReferences,
    prompts,
    invalidNumbers: [...selection.invalidNumbers],
    ...(imageRequests ? { imageRequests } : {}),
  };
}
