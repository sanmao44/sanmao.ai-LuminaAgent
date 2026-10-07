const CANVAS_TEXT_REFERENCE_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "html", "htm", "css",
  "js", "jsx", "ts", "tsx", "py", "java", "sql", "xml", "svg", "yaml",
  "yml", "sh", "ps1",
]);

export function hasExternalFileTransfer(
  dataTransfer: Pick<DataTransfer, "types" | "items">,
) {
  return (
    dataTransfer.types.includes("Files") ||
    [...dataTransfer.items].some((item) => item.kind === "file")
  );
}

export function canvasFileFromDataUrl(dataUrl: string, name: string) {
  const [header, encoded = ""] = dataUrl.split(",");
  const mime = header.match(/^data:([^;]+)/)?.[1] || "image/png";
  const bytes = atob(encoded);
  const content = new Uint8Array(bytes.length);
  for (let index = 0; index < bytes.length; index += 1) {
    content[index] = bytes.charCodeAt(index);
  }
  return new File([content], name, { type: mime });
}

export function isCanvasTextReferenceFile(
  file: Pick<File, "name" | "type">,
) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  return file.type.startsWith("text/") || CANVAS_TEXT_REFERENCE_EXTENSIONS.has(extension) ||
    ["application/json", "application/xml", "image/svg+xml"].includes(file.type);
}

export function isCanvasAudioFile(file: Pick<File, "name" | "type">) {
  return file.type.startsWith("audio/") ||
    /\.(aac|flac|m4a|mp3|oga|ogg|opus|wav|webm)$/i.test(file.name);
}
