import { describe, expect, it } from "vitest";
import { panelPosition } from "./panelPosition";

describe("panelPosition", () => {
  const anchor = { left: 100, top: 400, bottom: 430 };
  const viewport = { width: 800, height: 600 };
  it("默认往下，锚定按钮底部并按视口剩余空间限制高度", () => {
    expect(panelPosition(anchor, viewport)).toEqual({ left: 100, top: 436, maxHeight: 156 });
    expect(panelPosition({ left: -20, top: 10, bottom: 30 }, viewport)).toEqual({ left: 8, top: 36, maxHeight: 556 });
    expect(panelPosition({ left: 790, top: 10, bottom: 30 }, viewport).left).toBe(496);
  });
  it("往上用按钮顶部锚定底边，不依赖面板内容高度", () => {
    expect(panelPosition(anchor, viewport, "up")).toEqual({ left: 100, bottom: 206, maxHeight: 386 });
  });
  it("往上可用空间少时限制高度，预留顶部边距", () => {
    expect(panelPosition({ left: 100, top: 100, bottom: 130 }, viewport, "up"))
      .toEqual({ left: 100, bottom: 506, maxHeight: 86 });
  });
  it("902 高视窗中 y=618 的视频设置可使用至少 600 像素", () => {
    expect(panelPosition({ left: 100, top: 618, bottom: 648 }, { width: 1600, height: 902 }, "up").maxHeight)
      .toBeGreaterThanOrEqual(600);
  });
  it("向下空间不足时高度不为负数", () => {
    expect(panelPosition({ left: 100, top: 595, bottom: 610 }, viewport)).toEqual({ left: 100, top: 592, maxHeight: 0 });
  });
  it("向下的短列表靠近底部时按实测高度上移，仍能完整操作", () => {
    expect(panelPosition({ left: 100, top: 780, bottom: 810 }, { width: 1600, height: 902 }, "down", 180))
      .toEqual({ left: 100, top: 714, maxHeight: 180 });
  });
  it("向下内容高于视窗时贴顶，只在空间不足时滚动", () => {
    expect(panelPosition(anchor, viewport, "down", 1000)).toEqual({ left: 100, top: 8, maxHeight: 584 });
  });
});
