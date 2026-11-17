/**
 * 11-16 图层分离在浏览器里做的两件图片活：
 *  - 火山只收 PNG / JPG：卡上是 WebP 时先转成 PNG（交给调用方另存一份上传）；
 *  - 「合并」：底图 + 各层按摆好的位置、大小、角度、翻转画到一张原尺寸画布上，导出 PNG（本机合成，不花钱）。
 */
import type { EditLayer } from '@/domain/layers';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('有一张图层图片读不出来（可能被删了）。'));
    image.src = url;
  });
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('合成图片导出失败。')), 'image/png'));
}

/** 读到的不是 PNG / JPG 就转成 PNG 返回；是的话返回 null（原图直接交）。 */
export async function pngIfNeeded(url: string): Promise<Blob | null> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('原图读不出来（可能被删了）。');
  const blob = await response.blob();
  if (blob.type === 'image/png' || blob.type === 'image/jpeg') return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')!.drawImage(image, 0, 0);
    return await toPng(canvas);
  } finally { URL.revokeObjectURL(objectUrl); }
}

/** 按底图原尺寸合成；隐藏的层不画。数组后面的盖在上面。 */
export async function composeLayers(baseUrl: string, width: number, height: number, layers: readonly EditLayer[],
  urlOf: (work: string) => string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(await loadImage(baseUrl), 0, 0, width, height);
  for (const layer of layers) {
    if (layer.hidden) continue;
    const image = await loadImage(urlOf(layer.work));
    ctx.save();
    ctx.translate(layer.x, layer.y);
    ctx.rotate(layer.rotation * Math.PI / 180);
    ctx.scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
    ctx.drawImage(image, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
    ctx.restore();
  }
  return toPng(canvas);
}
