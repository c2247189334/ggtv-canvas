import { expect, it } from 'vitest';
import { defaultMotionReference, selectedMotionReference } from './motionReference';

it('人物、脸、发型、头发、衣、穿、服、装任一个词都默认白模；其他默认深度', () => {
  for (const text of ['人物换成我的', '换脸', '发型变短', '头发变黑', '衣服换掉', '穿长裙', '服饰', '换装']) {
    expect(defaultMotionReference(text, true)).toBe('mesh');
  }
  expect(defaultMotionReference('背景换成海边', true)).toBe('depth');
  expect(defaultMotionReference('', true)).toBe('depth');
  for (const text of ['镜头拉远', '模型改成2.5', '发光的背景']) expect(defaultMotionReference(text, true)).toBe('depth');
});
it('白模未配好默认深度，用户手动选择后不跟原话和体检变化', () => {
  expect(defaultMotionReference('人物换成我的', false)).toBe('depth');
  expect(selectedMotionReference('背景换掉', false, 'mesh')).toBe('mesh');
  expect(selectedMotionReference('人物换掉', true, 'depth')).toBe('depth');
  expect(selectedMotionReference('人物换掉', true, null)).toBe('mesh');
});
