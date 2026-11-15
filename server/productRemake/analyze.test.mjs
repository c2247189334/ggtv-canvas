import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../testKit.mjs';
import { analyzeProduct, productPlanFromReply } from './analyze.mjs';
import { planFixture } from './productFixture.mjs';

test('商品拆解只问一次，沿用总览与6张清楚大帧，只问商品/身体/外观/动作时间表/疑问', async () => {
  const folder = tempDir(), calls = [], times = [];
  const touch = name => { writeFileSync(join(folder, name), 'image'); return name; };
  const sheets = { timeline: async () => [touch('overview.jpg')], cuts: async () => [],
    frames: async (_, marks) => { times.push(marks); return marks.map((_, i) => touch(`${i}.jpg`)); } };
  const result = await analyzeProduct({ source: 'clip', folder, duration: 15, ratio: '9:16', userText: '鞋子' },
    { sheets, ask: async input => { calls.push(input); return planFixture(); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].images.length, 7);
  assert.deepEqual(times[0], [1.3, 3.8, 6.3, 8.8, 11.3, 13.8]);
  for (const word of ['总览', '怎么动', '实物组', '同款同色摆在不同位置也各算一组', 'where', '只数这一组', '保留类别和位置', '不默认鲜绿', '商品不进looks', '拿起', '穿入', '停顿', '结尾']) assert.ok(calls[0].text.includes(word), word);
  // 11-04 真拆：原片商品的品牌、颜色、结构混进 name / layout / action / visible，小数秒让免费检查每条都红。
  for (const word of ['品类词', '不写品牌', '整数秒', '只写身体部位', 'layout只写', 'action只写']) assert.ok(calls[0].text.includes(word), word);
  assert.doesNotMatch(calls[0].text, /起因|发生几次|people:|clothes:/);
  assert.deepEqual(result.plan, planFixture());
});

test('修格式不改原回话，数字串/单项文字/撞号/越界/断轴都规整，0连到ceil结尾', () => {
  const reply = { products: [{ id: 'A', name: '鞋子', pairs: '一双', pieces: '2只', layout: '左脚' },
    { id: 'A', name: '另一款', pairs: '1', pieces: '2' }], visible: ['手', '腿'], face: 'true',
    looks: '地面', timeline: [{ from: '-2', to: '2.8', action: '抬脚' }, { from: '3.6', to: '99', action: '放下' }], unsure: '暗处不清楚' };
  const fixed = productPlanFromReply(reply, 6.2, '鞋子');
  assert.deepEqual(fixed.products.map(p => [p.id, p.pairs, p.pieces]), [['A', 1, 2], ['B', 1, 2]]);
  assert.deepEqual(fixed.timeline, [{ from: 0, to: 3, action: '抬脚' }, { from: 3, to: 7, action: '放下' }]);
  assert.deepEqual(fixed.unsure, ['暗处不清楚']); assert.equal(fixed.face, true); assert.equal(fixed.visible, '手、腿');
  assert.equal(reply.products[1].id, 'A'); assert.equal(reply.timeline[0].from, '-2');
  const words = productPlanFromReply({ products: '鞋子', timeline: '拿起并放下' }, 4, '鞋子');
  assert.equal(words.products[0].name, '鞋子'); assert.deepEqual(words.timeline, [{ from: 0, to: 4, action: '拿起并放下' }]);
});

test('没认出商品仍给一组用用户原话，提醒写明，完全坏回话拒绝且不重试', async () => {
  const plan = productPlanFromReply({ products: [], looks: [], timeline: [], unsure: [] }, 6, '鞋子');
  assert.equal(plan.products[0].name, '鞋子'); assert.ok(plan.unsure.includes('拆解没认出鞋子，请核一眼'));
  assert.deepEqual(plan.timeline, [{ from: 0, to: 6, action: '按参考视频完成动作' }]);
  assert.throws(() => productPlanFromReply(null, 6, '鞋子'), /拆解回话/);
});

test('商品编号规整后时间轴和布局中的商品引用同步，未过滤的外观编号准确保留', () => {
  const reply = { products: [{ id: 'X1', name: '鞋子', pairs: 1, pieces: 2, layout: '商品X1在左边' }],
    looks: [{ id: 'bad', target: '无名称' }, { id: 'S2', kind: 'scene', what: '地面', now: '黑色地砖', target: '灰色木地板' }],
    timeline: [{ from: 0, to: 6, action: '手拿商品X1' }] };
  const result = productPlanFromReply(reply, 6, '鞋子');
  assert.equal(result.products[0].id, 'A'); assert.equal(result.products[0].layout, '商品A在左边');
  assert.equal(result.timeline[0].action, '手拿商品A'); assert.equal(result.looks[0].id, 'S2');
});

test('11-04 晚按实物组分：where 截到 8 字、不带就不写，三组各自编号和数量', () => {
  const plan = productPlanFromReply({ products: [
    { id: 'x', name: '鞋子', where: '脚上', look: '', pairs: 1, pieces: 2, layout: '开头在台面上，拿起后穿在脚上' },
    { id: 'y', name: '鞋子', where: '后排靠墙台面的上面那一层', look: '', pairs: 1, pieces: 2, layout: '一直摆在后排' },
    { id: 'z', name: '鞋子', look: '', pairs: 1, pieces: 2, layout: '后排下层' }], visible: '腿', face: false, looks: [], timeline: [], unsure: [] }, 15, '鞋子');
  assert.deepEqual(plan.products.map(p => [p.id, p.where, p.pieces]), [['A', '脚上', 2], ['B', '后排靠墙台面的上', 2], ['C', undefined, 2]]);
  assert.ok(!('where' in plan.products[2]));
});
