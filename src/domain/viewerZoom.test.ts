import { describe, expect, it } from "vitest";
import { fitSize, panWithin, VIEWER_RESET, wheelZoom } from "./viewerZoom";

describe("看大图缩放和拖动", () => {
  it("Ctrl + 滚轮往上一格放大约 1.06 倍；不小于原大、不超过 8 倍", () => {
    expect(wheelZoom(VIEWER_RESET, -120).scale).toBeCloseTo(1.06, 5);
    expect(wheelZoom(VIEWER_RESET, 120).scale).toBe(1);
    expect(wheelZoom({ scale: 7.9, x: 0, y: 0 }, -1200).scale).toBe(8);
  });

  it("触控板的小步滚动按比例算，不会一下跳很多", () => {
    expect(wheelZoom(VIEWER_RESET, -12).scale).toBeCloseTo(Math.pow(1.06, 0.1), 5);
  });

  it("缩放保留已经拖过的位置", () => {
    expect(wheelZoom({ scale: 2, x: 30, y: -10 }, -120)).toMatchObject({ x: 30, y: -10 });
  });

  it("图按比例放满框，小图也放大", () => {
    expect(fitSize({ width: 1341, height: 722 }, { width: 1152, height: 2048 })).toEqual({ width: 406.125, height: 722 });
    expect(fitSize({ width: 800, height: 600 }, { width: 200, height: 100 })).toEqual({ width: 800, height: 400 });
    expect(fitSize({ width: 800, height: 600 }, { width: 0, height: 0 })).toEqual({ width: 800, height: 600 });
  });

  it("拖动不让图跑出框：原大时竖着顶满就不动、横着能在空白里挪", () => {
    const box = { width: 1341, height: 722 };
    const image = { width: 406, height: 722 };
    expect(panWithin(VIEWER_RESET, -89, -50, box, image)).toEqual({ scale: 1, x: -89, y: 0 });
    expect(panWithin(VIEWER_RESET, -2000, 0, box, image).x).toBe(-467.5);
  });

  it("放大后能拖到看见边", () => {
    const box = { width: 800, height: 600 };
    const image = { width: 800, height: 600 };
    expect(panWithin({ scale: 2, x: 0, y: 0 }, 1000, -1000, box, image)).toEqual({ scale: 2, x: 400, y: -300 });
  });
});
