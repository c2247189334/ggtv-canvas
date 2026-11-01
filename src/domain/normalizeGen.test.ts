import { describe, expect, it } from "vitest";
import { normalizeGen } from "./normalizeGen";
import { DEFAULT_GEN } from "./cards";
import { FLASH_MODEL, LITE_MODEL } from "./pricing";

describe("normalizeGen", () => {
  it("旧存档缺分辨率补 2K，保留跟图编号与 3 张", () => {
    expect(normalizeGen({ model: FLASH_MODEL, aspect: "1:1", sizeFrom: 2, count: 3 }))
      .toEqual({ model: FLASH_MODEL, aspect: "1:1", resolution: "2K", sizeFrom: 2, count: 3 });
  });
  it.each(["1:2", "2:1", "5:4", "4:5", "9:21", "toString"])("旧比例 %s 退回 16:9", (aspect) => {
    expect(normalizeGen({ ...DEFAULT_GEN, aspect }).aspect).toBe("16:9");
  });
  it("切到 Lite 时 1K 与 21:9 一起纠正，保持跟图片来源", () => {
    const before = { ...DEFAULT_GEN, model: LITE_MODEL, resolution: "1K", aspect: "21:9", sizeFrom: 2 };
    expect(normalizeGen(before)).toEqual({ ...before, resolution: "2K", aspect: "16:9" });
  });
  it("切到 Flash 时 3K 纠正为 2K，保留可用比例", () => {
    expect(normalizeGen({ ...DEFAULT_GEN, resolution: "3K", aspect: "3:4" }))
      .toEqual({ ...DEFAULT_GEN, resolution: "2K", aspect: "3:4" });
  });
  it.each([
    [FLASH_MODEL, "1K", "21:9"], [FLASH_MODEL, "2K", "16:9"],
    [LITE_MODEL, "2K", "3:2"], [LITE_MODEL, "3K", "2:3"]
  ])("合法组合 %s / %s / %s 保留且不修改输入", (model, resolution, aspect) => {
    const gen = { ...DEFAULT_GEN, model, resolution, aspect };
    expect(normalizeGen(gen)).toEqual(gen);
    expect(gen).toEqual({ ...DEFAULT_GEN, model, resolution, aspect });
    expect(normalizeGen(normalizeGen(gen))).toEqual(gen);
  });
  it.each([null, undefined, "bad", {}, { model: "x", resolution: "4K", count: 99, sizeFrom: -1 }])("坏设置 %j 用默认值", (raw) => {
    expect(normalizeGen(raw)).toEqual({ model: FLASH_MODEL, resolution: "2K", aspect: "16:9", count: 1, sizeFrom: 1 });
  });
});
