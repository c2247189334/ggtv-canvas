import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkJobInput } from './jobInput.mjs';

const FLASH = 'doubao-seedream-5-0-flash-260915';
const REF = { type: 'work', id: '22222222-2222-4222-8222-222222222222' };
const good = {
  canvasId: '11111111-1111-4111-8111-111111111111',
  cardId: 'card-ab12cd34',
  model: FLASH,
  prompt: ' 一只猫 ',
  size: '1024x1024',
  count: 2,
  refs: [REF]
};
const always = () => true;

test('出图不能拿视频当参考', () => {
  const r = checkJobInput(good, () => ({ kind: 'video', contentType: 'video/mp4' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /出图不能拿视频当参考/);
});

test('合格的请求：去掉首尾空白、带上单价、参考图只留 type 和 id', () => {
  const r = checkJobInput({ ...good, refs: [{ ...REF, extra: 1 }] }, always);
  assert.equal(r.ok, true);
  assert.equal(r.job.prompt, '一只猫');
  assert.equal(r.job.priceYuan, 0.12);
  assert.deepEqual(r.job.refs, [REF]);
  assert.equal(r.job.count, 2);
});

test('没有尺寸也行（交给火山默认）', () => {
  const r = checkJobInput({ ...good, size: undefined }, always);
  assert.equal(r.ok, true);
  assert.equal(r.job.size, null);
});

const bad = [
  ['模型认不出', { model: 'gpt-image-2' }, /模型/],
  ['提示词是空的', { prompt: '   ' }, /先写一句/],
  ['提示词太长', { prompt: '字'.repeat(4001) }, /太长/],
  ['张数超了', { count: 5 }, /张数/],
  ['张数不是整数', { count: 1.5 }, /张数/],
  ['尺寸乱写', { size: '大大的' }, /尺寸/],
  ['画布编号乱写', { canvasId: '../x' }, /画布/],
  ['卡片编号乱写', { cardId: 'a/b' }, /卡片/],
  ['参考图不是数组', { refs: 'x' }, /参考图/],
  ['参考图类型不对', { refs: [{ type: 'file', id: REF.id }] }, /参考图/],
  ['参考图超过 8 张', { refs: Array.from({ length: 9 }, () => REF) }, /8/]
];
for (const [label, patch, pattern] of bad) {
  test(`拒收：${label}`, () => {
    const r = checkJobInput({ ...good, ...patch }, always);
    assert.equal(r.ok, false);
    assert.match(r.reason, pattern);
  });
}

test('参考图在硬盘上找不到就拒收', () => {
  const r = checkJobInput(good, () => false);
  assert.equal(r.ok, false);
  assert.match(r.reason, /找不到/);
});
