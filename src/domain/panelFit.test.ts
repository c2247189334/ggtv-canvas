import { expect, it } from 'vitest';
import { panelFit } from './panelFit';
import { BOTTOM_BARS } from './screenBars';

const screen = { width: 1570, height: 804 };

// 11-09 实测：面板伸到屏幕底时，左下「作品库 / 缩放 / 快捷键」那排盖在面板上（面板左下角的按钮点不到），所以底下让出按钮栏。
it('面板最多到左下按钮栏上沿，再矮也保留 260 让底行能挤出来', () => {
  // 11-08 实测：改写面板从 501 开始、746 高，发送按钮在屏幕外。
  expect(panelFit({ left: 1025, top: 501, width: 560 }, screen).maxHeight).toBe(260);
  expect(panelFit({ left: 1025, top: 401, width: 560 }, screen).maxHeight).toBe(804 - 401 - BOTTOM_BARS);
  expect(panelFit({ left: 100, top: 700, width: 420 }, screen).maxHeight).toBe(260);
  expect(panelFit({ left: 100, top: -200, width: 420 }, screen).maxHeight).toBe(804 + 200 - BOTTOM_BARS);
});

it('右边出屏往左挪回来，左边出屏往右挪；比屏幕还宽时先保左边', () => {
  expect(panelFit({ left: 1025, top: 100, width: 560 }, screen).shift).toBe(1570 - 8 - 1585);
  expect(panelFit({ left: -40, top: 100, width: 420 }, screen).shift).toBe(48);
  expect(panelFit({ left: 300, top: 100, width: 420 }, screen).shift).toBe(0);
  expect(panelFit({ left: 20, top: 100, width: 2000 }, screen).shift).toBe(-12);
});
