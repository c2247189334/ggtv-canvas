import { describe, expect, it } from "vitest";
import { CARD_HEIGHT, CARD_WIDTH, cardPositions, freeSpot, leftOf, rightOf, row } from "./placement";

describe("placement", () => {
  it("右边、左边隔一段", () => {
    expect(rightOf({ x: 0, y: 0 })).toEqual({ x: CARD_WIDTH + 100, y: 0 });
    expect(leftOf({ x: 0, y: 0 })).toEqual({ x: -(CARD_WIDTH + 100), y: 0 });
  });

  it("一次放几张往右排", () => {
    expect(row({ x: 0, y: 0 }, 2)).toEqual({ x: 2 * (CARD_WIDTH + 40), y: 0 });
  });

  it("被占了就往下挪，直到不重叠", () => {
    const taken = [{ x: 0, y: 0 }, { x: 0, y: CARD_HEIGHT + 40 }];
    expect(freeSpot({ x: 10, y: 10 }, taken)).toEqual({ x: 10, y: 10 + 2 * (CARD_HEIGHT + 40) });
    expect(freeSpot({ x: 1000, y: 0 }, taken)).toEqual({ x: 1000, y: 0 });
  });

  it("鼠标位置压着已有卡时，新卡仍放在指定点", () => {
    const at = { x: 25, y: 60 };
    expect(cardPositions(at, 1, [at], "row")).toEqual([at]);
  });

  it("连续从右＋生卡始终顶边对齐同一位置，不避让", () => {
    const source = { x: 20, y: 80 };
    const at = rightOf(source);
    expect(cardPositions(at, 1, [at], "row")).toEqual([{ x: 400, y: 80 }]);
    expect(cardPositions(leftOf(source), 1, [leftOf(source)], "row")).toEqual([{ x: -360, y: 80 }]);
  });

  it("鼠标处一次放三张，已有卡不影响往右排的位置", () => {
    const at = { x: -50, y: 75 };
    const taken = [{ x: -50, y: 75 }, { x: 270, y: 75 }, { x: 590, y: 75 }];
    expect(cardPositions(at, 3, taken, "row")).toEqual([
      { x: -50, y: 75 },
      { x: 270, y: 75 },
      { x: 590, y: 75 }
    ]);
  });

  it("批量上传参考图向下找空位，同时避开已有卡和本批新卡", () => {
    const taken = [{ x: 10, y: 20 }, { x: 10, y: 380 }];
    expect(cardPositions({ x: 10, y: 20 }, 2, taken, "column")).toEqual([
      { x: 10, y: 740 },
      { x: 10, y: 1100 }
    ]);
    expect(taken).toEqual([{ x: 10, y: 20 }, { x: 10, y: 380 }]);
    expect(cardPositions({ x: 1000, y: 20 }, 1, taken, "column")).toEqual([{ x: 1000, y: 20 }]);
  });

  it.each(["row", "column"] as const)("%s 模式没有新卡时不生成位置", (layout) => {
    expect(cardPositions({ x: 0, y: 0 }, 0, [], layout)).toEqual([]);
  });
});
