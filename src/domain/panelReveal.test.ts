import { expect, it } from 'vitest';
import { revealShift } from './panelReveal';

const screen = { width: 1366, height: 727 };
const box = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height });

// 11-17 用户定：面板掉出屏幕（看不到「发送」）时把画布挪一下，只挪刚好够的距离。
it('新图片卡放在屏幕中间、面板底掉出屏幕：往上挪到面板底停在左下按钮栏上面', () => {
  // 当时实测：卡 500,360 280×214，面板 430,588 420×201，「发送」在 747 > 727。
  expect(revealShift(box(500, 360, 280, 214), box(430, 588, 420, 201), screen)).toEqual({ dx: 0, dy: -124 });
});

it('视频卡在下半屏、改写输入面板整个在屏幕外：也挪回来', () => {
  expect(revealShift(box(700, 520, 280, 190), box(630, 724, 420, 200), screen)).toEqual({ dx: 0, dy: -259 });
});

it('卡和面板本来就都在屏内：不动', () => {
  expect(revealShift(box(500, 160, 280, 214), box(430, 388, 420, 201), screen)).toEqual({ dx: 0, dy: 0 });
});

it('卡顶钻进顶上按钮栏：往下挪到留出工具条的位置', () => {
  expect(revealShift(box(500, 20, 280, 214), box(430, 248, 420, 201), screen)).toEqual({ dx: 0, dy: 84 });
});

it('卡伸出屏幕右边 / 左边：横着挪回来，各留 24', () => {
  expect(revealShift(box(1200, 160, 280, 214), box(938, 388, 420, 201), screen)).toEqual({ dx: -138, dy: 0 });
  expect(revealShift(box(-100, 160, 280, 214), box(8, 388, 420, 201), screen)).toEqual({ dx: 124, dy: 0 });
});

it('卡加面板比屏幕能用的高度还高：平移救不了，交给调用方缩小', () => {
  expect(revealShift(box(500, 100, 280, 500), box(430, 614, 420, 260), screen)).toBeNull();
});
