export type Resolution = "1K" | "2K" | "3K";

const TARGET_PIXELS: Record<Resolution, number> = { "1K": 1024 ** 2, "2K": 2048 ** 2, "3K": 3072 ** 2 };

/** 按总像素和原图比例求边长，再对齐到 16；极端参考图限制在 1:16 ~ 16:1。 */
export function imageSize({ width, height }: { width: number; height: number }, resolution: Resolution): string {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error("图片尺寸无效。");
  }
  const ratio = Math.max(1 / 16, Math.min(16, width / height));
  const pixels = TARGET_PIXELS[resolution];
  const w = Math.round(Math.sqrt(pixels * ratio) / 16) * 16;
  const h = Math.round(Math.sqrt(pixels / ratio) / 16) * 16;
  // 对齐不能让临近边界的比例越过 16:1。
  return `${Math.min(w, h * 16)}x${Math.min(h, w * 16)}`;
}
