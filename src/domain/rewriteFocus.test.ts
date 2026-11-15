import { expect, it } from 'vitest';
import { TOOLBAR_SPACE, rewriteFocusViewport } from './rewriteFocus';
import { BOTTOM_BARS, TOP_BARS } from './screenBars';
import { toolbarPosition } from './toolbarPosition';

// 11-09：四角按钮栏盖在卡和面板上——卡顶别进上面那条（卡标题会被「GG TV / 画布名」盖住），面板底别进下面那条（左下按钮压住面板）。
it('对准后卡顶在顶上按钮栏下面、面板底在左下按钮栏上面', () => {
  const screen = { width: 1024, height: 768 }, card = { x: 0, y: 0, width: 280, height: 560 }, panel = { width: 420, height: 200 };
  for (const options of [{}, { maxZoom: 1.5, align: 'center' as const, top: TOOLBAR_SPACE }]) {
    const view = rewriteFocusViewport(card, panel, screen, 2, options);
    const top = view.y + card.y * view.zoom;
    expect(top).toBeGreaterThanOrEqual(TOP_BARS);
    expect(top + card.height * view.zoom + 14 + panel.height).toBeLessThanOrEqual(screen.height - BOTTOM_BARS);
  }
});
it('双击给卡顶留的位置够工具条放在卡上方、又不钻进顶上按钮栏', () => {
  const tools = { width: 390, height: 37 };
  const card = { left: 300, right: 580, top: TOOLBAR_SPACE, bottom: TOOLBAR_SPACE + 400 };
  expect(toolbarPosition(card, tools, { width: 1024, height: 768 }, true).top).toBe(TOOLBAR_SPACE - tools.height - 10);
});

it('竖视频和固定屏幕尺寸的面板一同入屏，原缩放装得下时不放大', () => {
  for (const size of [{ width: 1600, height: 1100 }, { width: 900, height: 650 }]) {
    const card = { x: 1140, y: 500, width: 280, height: 520 }, panel = { width: 420, height: 310 };
    const view = rewriteFocusViewport(card, panel, size, 1);
    const left = view.x + card.x * view.zoom, top = view.y + card.y * view.zoom;
    expect(left).toBeGreaterThanOrEqual(24);
    expect(left + card.width * view.zoom).toBeLessThanOrEqual(size.width - 24);
    expect(top).toBeGreaterThanOrEqual(24);
    expect(top + card.height * view.zoom + 14 + panel.height).toBeLessThanOrEqual(size.height - 24);
    expect(view.zoom).toBeLessThanOrEqual(1);
  }
  expect(rewriteFocusViewport({ x: 0, y: 0, width: 280, height: 520 }, { width: 420, height: 310 },
    { width: 1600, height: 1100 }, 0.5).zoom).toBe(0.5);
});
it('双击卡片（11-08 用户定）：最多放到 1.5 倍，卡居中，下方面板整块在屏幕里', () => {
  const screen = { width: 1570, height: 804 }, panel = { width: 420, height: 240 };
  const card = { x: 2000, y: 900, width: 280, height: 214 };
  const view = rewriteFocusViewport(card, panel, screen, 0.24, { maxZoom: 1.5, align: 'center' });
  expect(view.zoom).toBe(1.5);
  const left = view.x + card.x * view.zoom, top = view.y + card.y * view.zoom;
  expect(left + card.width * view.zoom / 2).toBeCloseTo(screen.width / 2);
  expect(top).toBeGreaterThanOrEqual(24);
  expect(top + card.height * view.zoom + 14 + panel.height).toBeLessThanOrEqual(screen.height - 24);
  // 竖图装不下 1.5 倍：按面板和卡顶工具条留出的高度缩小，面板照样看得见、卡顶留够 60 给工具条（11-08 实测压住面板）。
  const tall = { x: 0, y: 0, width: 280, height: 498 };
  const fit = rewriteFocusViewport(tall, panel, screen, 3.13, { maxZoom: 1.5, align: 'center', top: 60 });
  expect(fit.zoom).toBeLessThan(1.5);
  expect(fit.y).toBeGreaterThanOrEqual(60);
  expect(fit.y + tall.height * fit.zoom + 14 + panel.height).toBeLessThanOrEqual(screen.height - 24);
});
it('面板从卡左边往右展开（10-30）：卡和面板合起来居中，面板右边不出屏', () => {
  const card = { x: 1140, y: 500, width: 280, height: 520 }, panel = { width: 560, height: 420 }, size = { width: 800, height: 900 };
  const view = rewriteFocusViewport(card, panel, size, 1);
  const left = view.x + card.x * view.zoom;
  expect(left).toBeGreaterThanOrEqual(24);
  expect(left + panel.width).toBeLessThanOrEqual(size.width - 24);
});
