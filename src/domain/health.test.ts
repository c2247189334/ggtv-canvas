import { describe, expect, it } from "vitest";
import { missingDepthConfig } from "./health";

describe("深度配置缺项", () => {
  const ready = { filled: true, found: true };
  it("已填写且存在的三项全部通过", () => {
    expect(missingDepthConfig({ python: ready, modelDir: ready, extraPackages: ready })).toEqual([]);
  });
  it("服务端允许额外包不填，页面同样就绪", () => {
    expect(missingDepthConfig({ python: ready, modelDir: ready, extraPackages: { filled: false, found: false } })).toEqual([]);
  });
  it("未填写、已填写但没找到都列为缺项，保留环境变量名", () => {
    expect(missingDepthConfig({ python: { filled: false, found: false }, modelDir: ready,
      extraPackages: { filled: true, found: false } })).toEqual(["DEPTH_PYTHON", "DEPTH_EXTRA_PACKAGES"]);
    expect(missingDepthConfig()).toEqual(["DEPTH_PYTHON", "DEPTH_MODEL_DIR"]);
  });
});
