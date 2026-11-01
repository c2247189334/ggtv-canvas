import { describe, expect, it } from "vitest";
import { FLASH_MODEL, LITE_MODEL, IMAGE_MODELS, estimateYuan, formatSpent, formatYuan, isModelId } from "./pricing";

describe("pricing", () => {
  it("Flash 一张 0.12、Lite 一张 0.22，按张数乘", () => {
    expect(estimateYuan(FLASH_MODEL, 1)).toBe(0.12);
    expect(estimateYuan(FLASH_MODEL, 2)).toBe(0.24);
    expect(estimateYuan(LITE_MODEL, 3)).toBe(0.66);
  });

  it("模型表提供真名、提示、分辨率和有序比例", () => {
    const aspects = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"];
    expect(IMAGE_MODELS).toEqual([
      { id: FLASH_MODEL, name: "Seedream 5.0 Flash", yuan: 0.12, hint: "¥0.12", resolutions: ["1K", "2K"], aspects },
      { id: LITE_MODEL, name: "Seedream 5.0 Lite", yuan: 0.22, hint: "¥0.22", resolutions: ["2K", "3K"], aspects: aspects.slice(0, -1) }
    ]);
  });

  it("认不出的模型按最贵的报（宁可报高）", () => {
    expect(estimateYuan("x", 2)).toBe(0.44);
  });

  it("张数不是正整数按 0 算", () => {
    expect(estimateYuan(FLASH_MODEL, 0)).toBe(0);
    expect(estimateYuan(FLASH_MODEL, 1.5)).toBe(0);
  });

  it("显示成「约 ¥0.12」", () => {
    expect(formatYuan(0.12)).toBe("约 ¥0.12");
  });

  it("已花的钱至少两位小数、最多四位，几乎为零的不显示成零", () => {
    expect(formatSpent(0)).toBe("¥0.00");
    expect(formatSpent(0.04 + 0.03)).toBe("¥0.07");
    expect(formatSpent(0.0112)).toBe("¥0.0112");
    expect(formatSpent(12.5)).toBe("¥12.50");
    expect(formatSpent(0.0000352)).toBe("不到 ¥0.0001");
  });

  it("只认表里两款", () => {
    expect(isModelId(FLASH_MODEL)).toBe(true);
    expect(isModelId("gpt-image-2")).toBe(false);
  });
});
