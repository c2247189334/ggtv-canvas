import type { GenSettings } from "@/types";
import { isAspectId } from "./aspects";
import { DEFAULT_GEN } from "./cards";
import { IMAGE_MODELS, MAX_COUNT } from "./pricing";
import type { Resolution } from "./imageSize";

/** 换模型和读取旧存档共用：保留有效设置，模型不支持的尺寸回到 2K / 16:9。 */
export function normalizeGen(raw: unknown): GenSettings {
  const { model, resolution, aspect, sizeFrom, count } = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const selected = IMAGE_MODELS.find((m) => m.id === model) ?? IMAGE_MODELS[0];
  return {
    model: selected.id,
    resolution: selected.resolutions.includes(resolution as Resolution) ? resolution as Resolution : DEFAULT_GEN.resolution,
    aspect: isAspectId(aspect) && selected.aspects.includes(aspect) ? aspect : DEFAULT_GEN.aspect,
    sizeFrom: typeof sizeFrom === "number" && Number.isInteger(sizeFrom) && sizeFrom >= 0 ? sizeFrom : DEFAULT_GEN.sizeFrom,
    count: typeof count === "number" && Number.isInteger(count) && count >= 1 && count <= MAX_COUNT ? count : DEFAULT_GEN.count
  };
}
