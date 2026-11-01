import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_EDGE, fitWithin } from "./imagePrep";

describe("fitWithin", () => {
  it("本来就够小原样返回", () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("长边缩到 1600，比例不变", () => {
    expect(MAX_UPLOAD_EDGE).toBe(1600);
    expect(fitWithin({ width: 4000, height: 3000 })).toEqual({ width: 1600, height: 1200 });
  });
});
