function blobAsPng(blob: Blob): Promise<Blob> {
  if (blob.type.toLowerCase() === "image/png") return Promise.resolve(blob);

  return new Promise((resolve, reject) => {
    if (typeof document === "undefined" || typeof Image === "undefined") {
      reject(new Error("当前浏览器不支持图片格式转换。"));
      return;
    }
    const sourceUrl = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const width = Math.max(1, image.naturalWidth || image.width);
        const height = Math.max(1, image.naturalHeight || image.height);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("当前浏览器不支持图片格式转换。");
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((png) => {
          if (png) resolve(png);
          else reject(new Error("图片格式转换失败。"));
        }, "image/png");
      } catch (error) {
        reject(error instanceof Error ? error : new Error("图片格式转换失败。"));
      } finally {
        URL.revokeObjectURL(sourceUrl);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      reject(new Error("图片格式转换失败。"));
    };
    image.src = sourceUrl;
  });
}

/** Copy a canvas image as PNG to the system clipboard. */
export async function copyCanvasImageToClipboard(url: string) {
  if (!url.trim()) throw new Error("当前图片不可复制。");
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error("当前浏览器不支持复制图片，请使用复制节点。");
  }

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("无法读取当前图片，复制失败。");
  }
  if (!response.ok) throw new Error("无法读取当前图片，复制失败。");

  let source: Blob;
  try {
    source = await response.blob();
  } catch {
    throw new Error("无法读取当前图片，复制失败。");
  }
  if (!source.type.toLowerCase().startsWith("image/")) {
    throw new Error("当前节点不是可复制的图片。");
  }

  const png = await blobAsPng(source);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": png }),
    ]);
  } catch {
    throw new Error("复制图片失败，请检查浏览器的剪贴板权限。");
  }
}
