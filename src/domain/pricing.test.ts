import { describe, expect, it } from "vitest";
import { FLASH_MODEL, LITE_MODEL, IMAGE_MODELS, isModelId } from "./pricing";

describe("pricing", () => {
  it("模型表提供真名、分辨率和有序比例", () => {
    const aspects = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"];
    expect(IMAGE_MODELS).toEqual([
      { id: FLASH_MODEL, name: "Seedream 5.0 Flash", resolutions: ["1K", "2K"], aspects },
      { id: LITE_MODEL, name: "Seedream 5.0 Lite", resolutions: ["2K", "3K"], aspects: aspects.slice(0, -1) }
    ]);
  });

  it("只认表里两款", () => {
    expect(isModelId(FLASH_MODEL)).toBe(true);
    expect(isModelId("gpt-image-2")).toBe(false);
  });
});
