import { describe, expect, it } from "vitest";
import { menuTop } from "./menuPosition";

describe("菜单纵向定位", () => {
  it("放得下时保持点击位置", () => {
    expect(menuTop(100, 180, 902)).toBe(100);
  });
  it("底部放不下时往上挪，留 8 像素", () => {
    expect(menuTop(780, 180, 902)).toBe(714);
  });
  it("比整个视窗还高时贴顶，留出滚动区域", () => {
    expect(menuTop(780, 1000, 902)).toBe(8);
  });
  it("above 往上弹也不越过顶边", () => {
    expect(menuTop(100, 180, 902, true)).toBe(8);
    expect(menuTop(780, 180, 902, true)).toBe(600);
  });
});
