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
