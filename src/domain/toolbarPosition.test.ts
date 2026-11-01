import { describe, expect, it } from 'vitest';
import { toolbarPosition } from './toolbarPosition';

describe('toolbarPosition', () => {
  const viewport = { width: 1200, height: 800 }, toolbar = { width: 680, height: 40 };
  for (const zoom of [0.1, 1, 8]) {
    for (const edge of ['left', 'right', 'top'] as const) {
      it(`${zoom * 100}%缩放贴${edge}边时全部工具在屏内，上方不足放到下方`, () => {
        const width = 280 * zoom, height = 160 * zoom;
        const left = edge === 'left' ? 0 : edge === 'right' ? 1200 - width : 300;
        const top = edge === 'top' ? 4 : 160;
        const result = toolbarPosition({ left, right: left + width, top, bottom: top + height }, toolbar, viewport);
        expect(result.left).toBeGreaterThanOrEqual(8);
        expect(result.left + toolbar.width).toBeLessThanOrEqual(1192);
        expect(result.top).toBeGreaterThanOrEqual(8);
        expect(result.top + toolbar.height).toBeLessThanOrEqual(792);
        if (edge === 'top' && zoom < 8) expect(result.top).toBe(top + height + 10);
      });
    }
  }
  it('空间充足时保持卡上方居中', () => {
    expect(toolbarPosition({ left: 400, right: 680, top: 200, bottom: 360 }, toolbar, viewport))
      .toEqual({ left: 200, top: 150 });
  });
  it('巨型卡上下都超屏时仍把工具放在视口内', () => {
    expect(toolbarPosition({ left: -1000, right: 1800, top: -400, bottom: 2400 }, toolbar, viewport))
      .toEqual({ left: 60, top: 752 });
  });
});
