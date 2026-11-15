import { expect, it } from 'vitest';
import { tipPosition } from './tipPosition';

const screen = { width: 1000, height: 800 };

it('默认放在问号下面、左边对齐问号', () => {
  expect(tipPosition({ left: 100, top: 200, bottom: 216 }, { width: 300, height: 120 }, screen))
    .toEqual({ left: 100, top: 222, maxHeight: 570 });
});

it('下面放不下、上面空间更大就放上面', () => {
  expect(tipPosition({ left: 100, top: 700, bottom: 716 }, { width: 300, height: 200 }, screen))
    .toEqual({ left: 100, top: 494, maxHeight: 686 });
});

it('靠右的问号把气泡往左挪回屏幕里，靠左的不出左边', () => {
  expect(tipPosition({ left: 900, top: 100, bottom: 116 }, { width: 320, height: 80 }, screen).left).toBe(672);
  expect(tipPosition({ left: -40, top: 100, bottom: 116 }, { width: 320, height: 80 }, screen).left).toBe(8);
});

it('上下都放不下时选空间大的一边并限高，气泡自己滚动', () => {
  const low = tipPosition({ left: 100, top: 500, bottom: 516 }, { width: 300, height: 900 }, screen);
  expect(low).toEqual({ left: 100, top: 8, maxHeight: 486 });
  const high = tipPosition({ left: 100, top: 300, bottom: 316 }, { width: 300, height: 900 }, screen);
  expect(high).toEqual({ left: 100, top: 322, maxHeight: 470 });
});
