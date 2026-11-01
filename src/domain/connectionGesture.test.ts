import { describe, expect, it } from "vitest";
import * as gesture from "./connectionGesture";

describe("＋点击与拖线", () => {
  it("按下不动和阈值内抖动仍是点击", () => {
    expect(gesture.connectionDragged(false, { x: 10, y: 20 }, { x: 10, y: 20 })).toBe(false);
    expect(gesture.connectionDragged(false, { x: 10, y: 20 }, { x: 13, y: 24 })).toBe(false);
  });
  it("任一方向移动超过5屏幕像素就是拖线", () => {
    for (const end of [{ x: 16, y: 20 }, { x: 4, y: 20 }, { x: 14, y: 24 }])
      expect(gesture.connectionDragged(false, { x: 10, y: 20 }, end)).toBe(true);
    expect(gesture.CONNECTION_DRAG_THRESHOLD).toBe(5);
  });
  it("拖出去再回原地也不能弹点击菜单", () => {
    expect(gesture.connectionDragged(true, { x: 10, y: 20 }, { x: 10, y: 20 })).toBe(true);
  });
});
