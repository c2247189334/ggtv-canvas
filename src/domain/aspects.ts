import { imageSize, type Resolution } from "@/domain/imageSize";

/**
 * 出图尺寸。没连参考图、或者自己选了比例时用这里的比例；连了参考图默认「跟图片1」。
 * 尺寸统一交给 imageSize 算，两边 16 的倍数，总像素由分辨率档位决定。
 * 从旧项目 src/domain/aspectRatios.ts 搬来，改了名字。
 */
export type AspectId = "1:1" | "9:16" | "16:9" | "3:4" | "4:3" | "3:2" | "2:3" | "21:9";

export const ASPECT_OPTIONS: Array<{ id: AspectId; label: string }> = [
  { id: "1:1", label: "1:1" },
  { id: "9:16", label: "9:16" },
  { id: "16:9", label: "16:9" },
  { id: "3:4", label: "3:4" },
  { id: "4:3", label: "4:3" },
  { id: "3:2", label: "3:2" },
  { id: "2:3", label: "2:3" },
  { id: "21:9", label: "21:9" }
];

const RATIOS: Record<AspectId, { width: number; height: number }> = {
  "1:1": { width: 1, height: 1 },
  "3:4": { width: 3, height: 4 },
  "4:3": { width: 4, height: 3 },
  "9:16": { width: 9, height: 16 },
  "16:9": { width: 16, height: 9 },
  "3:2": { width: 3, height: 2 },
  "2:3": { width: 2, height: 3 },
  "21:9": { width: 21, height: 9 }
};

export function isAspectId(value: unknown): value is AspectId {
  return typeof value === "string" && Object.hasOwn(RATIOS, value);
}

export function sizeOfAspect(id: AspectId, resolution: Resolution): string {
  return imageSize(RATIOS[id], resolution);
}

/** sizeFrom 取这个值 = 用自己选的比例。 */
export const SIZE_FROM_ASPECT = 0;

/** 这次尺寸实际按什么算：没连图只能用比例；选的那张已经断开就退回图片1。 */
export function sizeSourceOf(sizeFrom: number, refCount: number): { ref: number } | { aspect: true } {
  if (refCount <= 0 || sizeFrom === SIZE_FROM_ASPECT) return { aspect: true };
  if (Number.isInteger(sizeFrom) && sizeFrom >= 1 && sizeFrom <= refCount) return { ref: sizeFrom };
  return { ref: 1 };
}
