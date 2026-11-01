import { expect, it } from 'vitest';
import { readRewriteChangeSeconds, readRewriteItem, readRewritePlan, readRewriteStatus } from './videoRewriteDoc';
import { readCard } from './canvasDoc';
import { newCard } from './cards';

const item = { id: 'p', kind: '人物' as const, desc: '一个人', from: 0, to: 6, frame: 1 };
it('只读单项的合法字段，坏时间、类型、缺id不带入画布', () => {
  expect(readRewriteItem({ ...item, private: 'discard' })).toEqual(item);
  for (const raw of [null, [], {}, { ...item, from: -1 }, { ...item, to: Infinity }, { ...item, to: -1 },
    { ...item, from: 5, to: 2 }, { ...item, kind: '陌生' }, { ...item, id: '' }, { ...item, desc: 2 }]) expect(readRewriteItem(raw)).toBeUndefined();
});
it('10-30 起拆解不问东西怎么动：10-29 旧存档里的 states 读回时丢掉，单项照常', () => {
  expect(readRewriteItem({ ...item, states: [{ from: 0, to: 4.6, state: '静止' }] })).toEqual(item);
});
it('改写状态：没做完的一律读成上次没做完；失败要有原话，费用不合法就标待确认', () => {
  expect(readRewriteStatus({ status: 'pending' })).toEqual({ status: 'interrupted' });
  expect(readRewriteStatus({ status: 'failed', error: '断线', yuan: 0.02, costUnknown: false })).toEqual({ status: 'failed', error: '断线', yuan: 0.02, costUnknown: false });
  expect(readRewriteStatus({ status: 'failed', error: '断线', yuan: -1 })).toEqual({ status: 'failed', error: '断线', yuan: 0, costUnknown: true });
  for (const raw of [null, [], { status: 'failed' }, { status: 'analyzing' }]) expect(readRewriteStatus(raw)).toBeUndefined();
});
it('10-26 一轮版拆解单没有补看秒数照样读回；旧存档带补看秒数、改正说明也能读，只是不再带入', () => {
  const plan = { summary: '一句话', items: [item], changes: [{ second: 2, how: '扇叶扫过' }], actions: [{ from: 0, to: 6, desc: '站立' }],
    replace: ['p'], unsure: [] };
  expect(readRewritePlan(plan)).toEqual(plan);
  expect(readRewritePlan({ ...plan, lookAgain: [1, 2], corrections: ['改了'] })).toEqual(plan);
  expect(readRewritePlan({ ...plan, unsure: '没有' })).toBeUndefined();
});
it('变化秒数只留时长内的非负数字', () => {
  expect(readRewriteChangeSeconds([5.5, -1, '9', 9, 16], 15)).toEqual([5.5, 9]);
  expect(readRewriteChangeSeconds('5', 15)).toBeUndefined();
});
it('图片卡单项描述随画布保存', () => {
  const image = { ...newCard('generate', 1), rewriteId: 'batch', rewriteItemId: item.id, rewriteItem: item, prompt: '单人干净背景' };
  expect(readCard(image)).toMatchObject({ rewriteItem: item, prompt: image.prompt });
});
