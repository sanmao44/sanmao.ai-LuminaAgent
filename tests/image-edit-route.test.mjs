import assert from "node:assert/strict";
import test from "node:test";
import { createTsRequire } from "./ts-require.mjs";

function createEditRoute(resolveReference) {
  const logs = new Map();
  const calls = { editInputs: [], compositeInputs: [] };
  const runtimeModel = {
    model: { id: "common-image-model", rawId: "raw-common-image-model", displayName: "Common Image" },
    provider: { id: "common-provider", name: "Common Provider", platform: "custom", baseUrl: "https://provider.example/v1" },
  };
  const modules = {
    "@/lib/providers": {
      editImage: async (_provider, _model, input) => {
        calls.editInputs.push(input);
        return [{ url: "https://example.test/result.png" }];
      },
      imageDownloadAuth: () => undefined,
    },
    "@/lib/image-storage": { resolveStoredImageReference: resolveReference },
    "@/lib/generation-log": {
      startGenerationLog: async (input, id) => {
        logs.set(id, { ...input, id, status: "pending" });
        return id;
      },
      finishGenerationLog: async (id, patch) => logs.set(id, { ...logs.get(id), ...patch }),
      appendGenerationLog: async () => {},
    },
    "@/lib/generation-persistence": {
      persistGenerationResult: async ({ images, logId }) => {
        logs.set(logId, { ...logs.get(logId), status: "success", imageUrls: images.map((image) => image.url) });
        return { images, path: "" };
      },
    },
    "@/lib/store": {
      getPublicState: async () => ({ settings: { imageStoragePath: "" } }),
      getRuntimeImageModelCandidates: async () => [runtimeModel],
      getRuntimeImageModelForCapability: async () => runtimeModel,
      markProviderCredentialFailure: async () => {},
    },
    "@/lib/auth": { isTrustedAppRequest: () => true },
    "@/lib/reference-images": { referenceRecordsForLog: () => [] },
    "@/lib/local-edit-composite": {
      enforceLocalEditMask: async (images, sourceReference, maskReference, options) => {
        calls.compositeInputs.push({ sourceReference, maskReference, options });
        return images;
      },
    },
    "@/lib/runtime-operation": {
      beginRuntimeRequest: async () => async () => {},
      RuntimeDrainingError: class RuntimeDrainingError extends Error {},
    },
    "@/lib/image-orientation": {
      normalizeStarApiLandscapeImages: async (_provider, _model, _input, images) => images,
      normalizeStarApiLandscapePrompt: (_provider, _model, prompt) => prompt,
    },
    "@/packages/model-runtime/media": {
      invokeMediaModelCandidates: async (initial, _fallbacks, operation) => operation(initial),
    },
  };
  const { POST } = createTsRequire(process.cwd(), modules)("./app/api/edit/route");
  return { POST, logs, calls };
}

function editRequest(overrides = {}) {
  return new Request("http://localhost:3210/api/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: "local-edit-task-1",
      prompt: "replace the marked object",
      model: "auto",
      references: ["https://example.test/source.png"],
      referenceImages: [{ id: "source-1", name: "source", url: "https://example.test/source.png" }],
      count: 1,
      aspectRatio: "1:1",
      ...overrides,
    }),
  });
}

test("edit route creates its recovery record before resolving source images", async () => {
  let logs;
  const route = createEditRoute(async (reference) => {
    assert.equal(logs.get("local-edit-task-1")?.status, "pending");
    return reference;
  });
  logs = route.logs;

  const response = await route.POST(editRequest());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).images[0].url, "https://example.test/result.png");
  assert.equal(logs.get("local-edit-task-1").status, "success");
});

test("source resolution failures finish the pre-existing edit record", async () => {
  const route = createEditRoute(async () => { throw new Error("source image unavailable"); });
  const response = await route.POST(editRequest());

  assert.equal(response.status, 502);
  assert.equal(route.logs.get("local-edit-task-1").status, "error");
  assert.match(route.logs.get("local-edit-task-1").error, /source image unavailable/);
  assert.equal(route.logs.get("local-edit-task-1").errorCode, undefined);
});

test("move edits without a guide condition the Provider and composite against the original image", async () => {
  const moveSourceMask = "data:image/png;base64,bW92ZS1zb3VyY2UtbWFzaw==";
  const mask = "data:image/png;base64,bW92ZS1tYXNr";
  const source = "https://example.test/source.png";
  const route = createEditRoute(async (reference) => reference);

  const response = await route.POST(editRequest({ moveSourceMask, mask }));

  assert.equal(response.status, 200);
  assert.deepEqual(route.calls.editInputs[0].references, [source]);
  assert.equal(route.calls.compositeInputs[0].sourceReference, source);
  assert.equal(route.calls.compositeInputs[0].maskReference, mask);
  assert.equal(route.calls.compositeInputs[0].options.moveSourceMaskReference, moveSourceMask);
  assert.equal(route.calls.compositeInputs[0].options.moveSourceOriginalReference, source);
});

test("legacy move guides remain supported for persisted edit requests", async () => {
  const moveGuide = "data:image/png;base64,bW92ZS1ndWlkZQ==";
  const moveSourceMask = "data:image/png;base64,bW92ZS1zb3VyY2UtbWFzaw==";
  const mask = "data:image/png;base64,bW92ZS1tYXNr";
  const route = createEditRoute(async (reference) => reference);

  const response = await route.POST(editRequest({ moveGuide, moveSourceMask, mask }));

  assert.equal(response.status, 200);
  assert.deepEqual(route.calls.editInputs[0].references, [moveGuide]);
  assert.equal(route.calls.compositeInputs[0].sourceReference, moveGuide);
  assert.equal(route.calls.compositeInputs[0].maskReference, mask);
  assert.equal(route.calls.compositeInputs[0].options.moveSourceMaskReference, moveSourceMask);
  assert.equal(route.calls.compositeInputs[0].options.moveSourceOriginalReference, "https://example.test/source.png");
});
