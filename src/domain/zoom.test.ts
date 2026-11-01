import { expect, it } from "vitest";
import { MAX_ZOOM, zoomPresets } from "./zoom";
it("画布和菜单支持800%", () => {
  expect(MAX_ZOOM).toBe(8);
  expect(zoomPresets).toContainEqual({ label: "缩放到 800%", zoom: 8 });
});
it("三个预设统一写缩放到，保留对应倍率", () => {
  expect(zoomPresets).toEqual([
    { label: "缩放到 50%", zoom: 0.5 }, { label: "缩放到 100%", zoom: 1 }, { label: "缩放到 800%", zoom: 8 }
  ]);
});
