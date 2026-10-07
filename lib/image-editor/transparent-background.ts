export async function makeWhiteBackgroundTransparent<T extends { url: string }>(image: T): Promise<T> {
  const source = new Image();
  if (/^https?:/i.test(image.url)) source.crossOrigin = 'anonymous';
  await new Promise<void>((resolve, reject) => {
    source.onload = () => resolve();
    source.onerror = () => reject(new Error('图片读取失败'));
    source.src = image.url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = source.naturalWidth;
  canvas.height = source.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('浏览器不支持本地透明处理');

  context.drawImage(source, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index];
    const green = pixels.data[index + 1];
    const blue = pixels.data[index + 2];
    const min = Math.min(red, green, blue);
    const max = Math.max(red, green, blue);
    if (min > 218 && max - min < 24) {
      pixels.data[index + 3] = Math.min(
        pixels.data[index + 3],
        Math.max(0, Math.round(((255 - min) / 37) * 255)),
      );
    }
  }
  context.putImageData(pixels, 0, 0);

  return {
    ...image,
    url: canvas.toDataURL('image/png'),
  };
}
