export type ModelArtifactPreviewAsset = {
  body: ReadableStream<Uint8Array>;
  contentLength: number;
  contentType: 'model/gltf-binary';
};

export type ModelArtifactPreviewPort = {
  open(url: string): Promise<ModelArtifactPreviewAsset>;
};
