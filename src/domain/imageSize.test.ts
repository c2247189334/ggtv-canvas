import { describe, expect, it } from "vitest";
import { imageSize, type Resolution } from "./imageSize";
import { sizeOfAspect } from "./aspects";
import { FLASH_MODEL, LITE_MODEL } from "./pricing";

const ratios = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"] as const;
const tiers: Resolution[] = ["1K", "2K", "3K"];
const target = { "1K": 1024 ** 2, "2K": 2048 ** 2, "3K": 3072 ** 2 };

describe("imageSize", () => {
  it.each(tiers)("%s 正方形命中目标总像素", (resolution) => {
    const edge = Math.sqrt(target[resolution]);
    expect(imageSize({ width: 750, height: 750 }, resolution)).toBe(`${edge}x${edge}`);
  });

  it.each(tiers)("%s 自选比例和参考图用同一算法，像素与比例误差都小于 2%%", (resolution) => {
    for (const ratio of ratios) {
      const [w, h] = ratio.split(":").map(Number);
      const size = imageSize({ width: w * 100, height: h * 100 }, resolution);
      expect(sizeOfAspect(ratio, resolution)).toBe(size);
      const [width, height] = size.split("x").map(Number);
      expect(width % 16).toBe(0);
      expect(height % 16).toBe(0);
      expect(Math.abs(width / height - w / h) / (w / h)).toBeLessThan(0.02);
      expect(Math.abs(width * height / target[resolution] - 1)).toBeLessThan(0.02);
    }
  });

  it.each([
    [FLASH_MODEL, "1K", 1280 * 720, Math.floor(2048 ** 2 * 1.1025)],
    [FLASH_MODEL, "2K", 1280 * 720, Math.floor(2048 ** 2 * 1.1025)],
    [LITE_MODEL, "2K", 2560 * 1440, 4096 ** 2],
    [LITE_MODEL, "3K", 2560 * 1440, 4096 ** 2]
  ] as const)("%s / %s 全部可选比例在 seedreamSize 像素区间内", (model, resolution, min, max) => {
    for (const ratio of ratios.filter((r) => model !== LITE_MODEL || r !== "21:9")) {
      const [width, height] = sizeOfAspect(ratio, resolution).split("x").map(Number);
      expect(width * height).toBeGreaterThanOrEqual(min);
      expect(width * height).toBeLessThanOrEqual(max);
    }
  });

  it.each(tiers)("%s 极端参考图夹到 1:16 ~ 16:1，微小与巨大原图都可用", (resolution) => {
    for (const [width, height, ratio] of [[1, 1000, 1 / 16], [1000, 1, 16], [1, 1, 1], [60000, 60000, 1]]) {
      const [w, h] = imageSize({ width, height }, resolution).split("x").map(Number);
      expect(w % 16).toBe(0);
      expect(h % 16).toBe(0);
      expect(w / h).toBeGreaterThanOrEqual(1 / 16);
      expect(w / h).toBeLessThanOrEqual(16);
      expect(w / h).toBeCloseTo(ratio, 2);
      expect(Math.abs(w * h / target[resolution] - 1)).toBeLessThan(0.02);
    }
  });

  it.each([0, -10, 100.5, NaN, Infinity])("非法边长 %s 报错", (invalid) => {
    expect(() => imageSize({ width: invalid, height: 100 }, "2K")).toThrow("图片尺寸无效");
    expect(() => imageSize({ width: 100, height: invalid }, "2K")).toThrow("图片尺寸无效");
  });
});
