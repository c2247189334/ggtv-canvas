import { describe, expect, it } from 'vitest';
import { toolbarPosition } from './toolbarPosition';
import { BOTTOM_BARS, TOP_BARS } from './screenBars';

describe('toolbarPosition', () => {
  const viewport = { width: 1200, height: 800 }, toolbar = { width: 680, height: 40 };
  for (const zoom of [0.1, 1, 8]) {
    for (const edge of ['left', 'right', 'top'] as const) {
      it(`${zoom * 100}%缩放贴${edge}边时全部工具在屏内，上方不足贴着顶上按钮栏下沿`, () => {
        const width = 280 * zoom, height = 160 * zoom;
        const left = edge === 'left' ? 0 : edge === 'right' ? 1200 - width : 300;
        const top = edge === 'top' ? 4 : 160;
        const result = toolbarPosition({ left, right: left + width, top, bottom: top + height }, toolbar, viewport);
        expect(result.left).toBeGreaterThanOrEqual(8);
        expect(result.left + toolbar.width).toBeLessThanOrEqual(1192);
        expect(result.top).toBeGreaterThanOrEqual(TOP_BARS);
        expect(result.top + toolbar.height).toBeLessThanOrEqual(800 - BOTTOM_BARS);
        if (edge === 'top') expect(result.top).toBe(TOP_BARS);
      });
    }
  }
  it('空间充足时保持卡上方居中', () => {
    expect(toolbarPosition({ left: 400, right: 680, top: 200, bottom: 360 }, toolbar, viewport))
      .toEqual({ left: 200, top: 150 });
  });
  it('巨型卡上下都超屏时仍把工具放在视口内、贴着顶上按钮栏下沿', () => {
    expect(toolbarPosition({ left: -1000, right: 1800, top: -400, bottom: 2400 }, toolbar, viewport))
      .toEqual({ left: 60, top: TOP_BARS });
  });
});

// 11-09 用户截图：竖视频卡顶出了屏幕，工具条被挪到卡下面，正好被「视频改写」面板整条盖住（6 个按钮都点不到）。
describe('toolbarPosition 不和卡下面的面板、四角按钮栏重叠（11-09）', () => {
  const screen = { width: 1024, height: 768 }, tools = { width: 390, height: 37 };
  it('卡顶出屏、卡下面挂着面板：工具条压在卡上，底边不超过卡底（面板从卡底下 14 开始）', () => {
    const card = { left: 120, right: 512, top: -400, bottom: 459 };
    const result = toolbarPosition(card, tools, screen, true);
    expect(result.top).toBe(TOP_BARS);
    expect(result.top + tools.height).toBeLessThanOrEqual(card.bottom);
  });
  it('卡快整个挪出屏幕上边、下面有面板：工具条跟着卡底往上走，不压进面板', () => {
    const card = { left: 120, right: 512, top: -500, bottom: 79 };
    const result = toolbarPosition(card, tools, screen, true);
    expect(result.top + tools.height).toBeLessThanOrEqual(card.bottom);
  });
  it('卡下面没面板：卡挪出屏幕上边时工具条一直留在屏幕里', () => {
    expect(toolbarPosition({ left: 120, right: 512, top: -500, bottom: 20 }, tools, screen).top).toBe(TOP_BARS);
  });
  it('卡顶在 60：上方虽有 13 像素，那是左上 / 右上按钮栏的地方，工具条不钻进去', () => {
    expect(toolbarPosition({ left: 30, right: 310, top: 60, bottom: 620 }, tools, screen).top).toBe(TOP_BARS);
  });
  it('卡在屏幕底下：工具条不压进左下按钮栏', () => {
    const result = toolbarPosition({ left: 30, right: 310, top: 760, bottom: 1300 }, tools, screen);
    expect(result.top + tools.height).toBeLessThanOrEqual(screen.height - BOTTOM_BARS);
  });
});
