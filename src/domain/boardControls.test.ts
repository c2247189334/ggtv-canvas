import { SelectionMode } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { boardPointerControls, isOnlySelectedCard, shouldShowMultiSelection } from "./boardControls";

describe("boardPointerControls", () => {
  it("普通滚轮平移画布", () => {
    expect(boardPointerControls.panOnScroll).toBe(true);
  });

  it("滚轮位移不减速，120 像素滚动对应 120 屏幕像素", () => {
    expect(boardPointerControls.panOnScrollSpeed).toBe(1);
  });

  it("普通左键拖动不平移画布", () => {
    expect(boardPointerControls.panOnDrag).not.toContain(0);
  });

  it("中键拖动平移画布", () => {
    expect(boardPointerControls.panOnDrag).toEqual([1]);
  });

  it("空白处拖动开启框选", () => {
    expect(boardPointerControls.selectionOnDrag).toBe(true);
  });

  it("卡片部分重叠就选中", () => {
    expect(boardPointerControls.selectionMode).toBe(SelectionMode.Partial);
  });

  it("按住空格激活画布平移", () => {
    expect(boardPointerControls.panActivationKeyCode).toBe("Space");
  });
});

describe("isOnlySelectedCard", () => {
  it.each([
    [0, false],
    [1, true],
    [2, false]
  ])("这张卡被选中、共选中 %i 张时，显示左右 ＋ = %s", (count, expected) => {
    expect(isOnlySelectedCard(true, count)).toBe(expected);
  });

  it("唯一选中的是别的卡时，不显示这张卡的左右 ＋", () => {
    expect(isOnlySelectedCard(false, 1)).toBe(false);
  });
});

describe("shouldShowMultiSelection", () => {
  it.each([
    [0, false],
    [1, false],
    [2, true]
  ])("选中 %i 张时，显示多选大框 = %s", (count, expected) => {
    expect(shouldShowMultiSelection(count)).toBe(expected);
  });
});
