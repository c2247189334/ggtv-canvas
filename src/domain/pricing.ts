/**
 * 出图模型、可选尺寸和单张价格。默认 Seedream 5.0 Flash。
 * 价格是火山官方按张收的固定人民币价（旧项目 2026-09-26 查的），参考图不收钱。
 * ⚠ 小服务记账用的是 server/pricing.mjs 里同样两个数，改价两边一起改。
 */
import type { AspectId } from "./aspects";
import type { Resolution } from "./imageSize";

export const FLASH_MODEL = "doubao-seedream-5-0-flash-260915";
export const LITE_MODEL = "doubao-seedream-5-0-lite-260128";
export type ModelId = typeof FLASH_MODEL | typeof LITE_MODEL;

export const IMAGE_MODELS: Array<{
  id: ModelId; name: string; yuan: number; hint: string; resolutions: Resolution[]; aspects: AspectId[];
}> = [
  {
    id: FLASH_MODEL, name: "Seedream 5.0 Flash", yuan: 0.12, hint: "¥0.12", resolutions: ["1K", "2K"],
    aspects: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"]
  },
  {
    id: LITE_MODEL, name: "Seedream 5.0 Lite", yuan: 0.22, hint: "¥0.22", resolutions: ["2K", "3K"],
    aspects: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"]
  }
];

/** 一单最多几张。火山一次只出一张，小服务连发这么多次。 */
export const MAX_COUNT = 4;

export function isModelId(value: unknown): value is ModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}

/** 这一单大约多少钱（人民币）。认不出的模型按最贵的报——宁可报高，也别报低让人多花钱。 */
export function estimateYuan(model: string, count: number): number {
  const known = IMAGE_MODELS.find((m) => m.id === model);
  const each = known ? known.yuan : Math.max(...IMAGE_MODELS.map((m) => m.yuan));
  const n = Number.isInteger(count) && count > 0 ? count : 0;
  return Math.round(each * n * 100) / 100;
}

export function formatYuan(yuan: number): string {
  return `约 ¥${yuan.toFixed(2)}`;
}

/** 已花的钱：至少两位小数，豆包这类几分钱的花费最多显示到四位。 */
export function formatSpent(yuan: number): string {
  if (yuan > 0 && yuan < 0.00005) return "不到 ¥0.0001";
  return `¥${yuan.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 4, useGrouping: false })}`;
}
