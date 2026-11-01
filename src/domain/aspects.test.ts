import { describe, expect, it } from "vitest";
import { ASPECT_OPTIONS, isAspectId, sizeOfAspect, sizeSourceOf } from "./aspects";

describe("aspects", () => {
  const ratios = ["1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "21:9"] as const;
  it("提供任务单要求的8种比例，保持展示顺序", () => {
    expect(ASPECT_OPTIONS.map((option) => option.id)).toEqual(ratios);
  });
  it.each(ratios)("%s 合法、两边16倍数、比例误差小于2%%", (ratio) => {
    expect(isAspectId(ratio)).toBe(true);
    if (!isAspectId(ratio)) return;
    const [width, height] = sizeOfAspect(ratio, "2K").split("x").map(Number);
    const [x, y] = ratio.split(":").map(Number);
    expect(width % 16).toBe(0);
    expect(height % 16).toBe(0);
    expect(Math.abs(width / height - x / y) / (x / y)).toBeLessThan(0.02);
  });
  it("1:1 默认档 2K 出 2048x2048", () => {
    expect(sizeOfAspect("1:1", "2K")).toBe("2048x2048");
  });

  it("16:9 两边都是 16 的倍数，比例差不到 2%", () => {
    const [w, h] = sizeOfAspect("16:9", "2K").split("x").map(Number);
    expect(w % 16).toBe(0);
    expect(h % 16).toBe(0);
    expect(Math.abs(w / h - 16 / 9) / (16 / 9)).toBeLessThan(0.02);
  });

  it("没连图只能用比例", () => {
    expect(sizeSourceOf(1, 0)).toEqual({ aspect: true });
  });

  it("选了比例就用比例", () => {
    expect(sizeSourceOf(0, 3)).toEqual({ aspect: true });
  });

  it("跟图片2", () => {
    expect(sizeSourceOf(2, 3)).toEqual({ ref: 2 });
  });

  it("选的那张断开了，退回图片1", () => {
    expect(sizeSourceOf(3, 2)).toEqual({ ref: 1 });
  });

  it("只认列出的比例，原型链上的名字不算", () => {
    expect(isAspectId("16:9")).toBe(true);
    expect(isAspectId("toString")).toBe(false);
    expect(isAspectId(1)).toBe(false);
  });
});
