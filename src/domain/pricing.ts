/**
 * 出图模型和可选尺寸。默认 Seedream 5.0 Flash。
 */
import type { AspectId } from "./aspects";
import type { Resolution } from "./imageSize";

export const FLASH_MODEL = "doubao-seedream-5-0-flash-260915";
export const LITE_MODEL = "doubao-seedream-5-0-lite-260128";
export type ModelId = typeof FLASH_MODEL | typeof LITE_MODEL;

export const IMAGE_MODELS: Array<{
  id: ModelId; name: string; resolutions: Resolution[]; aspects: AspectId[];
}> = [
  {
    id: FLASH_MODEL, name: "Seedream 5.0 Flash", resolutions: ["1K", "2K"],
    aspects: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"]
  },
  {
    id: LITE_MODEL, name: "Seedream 5.0 Lite", resolutions: ["2K", "3K"],
    aspects: ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3"]
  }
];

/** 一单最多几张。火山一次只出一张，小服务连发这么多次。 */
export const MAX_COUNT = 4;

export function isModelId(value: unknown): value is ModelId {
  return IMAGE_MODELS.some((model) => model.id === value);
}

