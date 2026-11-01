import { expect, it } from 'vitest';
import { rewriteFocusViewport } from './rewriteFocus';

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
it('面板从卡左边往右展开（10-30）：卡和面板合起来居中，面板右边不出屏', () => {
  const card = { x: 1140, y: 500, width: 280, height: 520 }, panel = { width: 560, height: 420 }, size = { width: 800, height: 900 };
  const view = rewriteFocusViewport(card, panel, size, 1);
  const left = view.x + card.x * view.zoom;
  expect(left).toBeGreaterThanOrEqual(24);
  expect(left + panel.width).toBeLessThanOrEqual(size.width - 24);
});
