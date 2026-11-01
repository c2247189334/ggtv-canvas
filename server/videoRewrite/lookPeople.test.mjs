import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeLook, lookPeople, personMaterials } from './lookPeople.mjs';

const plan = { summary: '拆解', changes: [], actions: [], unsure: [], replace: ['P1', 'C1'], items: [
  { id: 'P1', kind: '人物', desc: '女生', from: 0, to: 6, frame: 0 }, { id: 'P2', kind: '人物', desc: '男生', from: 0, to: 6, frame: 0 },
  { id: 'C1', kind: '衣服', desc: '裙子', from: 0, to: 6, frame: 0 }] };
const asset = { type: 'work', id: '9626772f-638d-4bc6-aedc-f456383fb562' };
const person = { tag: '@图片2', purpose: '人物', itemId: 'P1', asset };
const image = 'data:image/jpeg;base64,AA==';

test('只问要换的人物图：背景、衣服、深度、没换的人、还没图的都不问', () => {
  const materials = [{ tag: '@图片1', purpose: '背景', asset }, person, { tag: '@图片3', purpose: '衣服', itemId: 'C1', asset },
    { tag: '@图片4', purpose: '人物', itemId: 'P2', asset }, { tag: '@图片5', purpose: '人物', itemId: 'P1' }, { tag: '@视频1', purpose: '深度' }];
  assert.deepEqual(personMaterials({ plan, materials }), [person]);
});

test('一次问完：列出编号、关思考、附同样多张图；回话转成每张图的样子', async () => {
  const calls = [];
  const ask = async input => {
    calls.push(input);
    return { people: [{ tag: '@图片2', views: '3', plainClothes: false, clothes: '  橙色长袖工作服和橙色长裤 ', hair: '灰白色短发' }] };
  };
  const looks = await lookPeople({ materials: [person], images: [image] }, { ask });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].round, 'look'); assert.equal(calls[0].think, false); assert.deepEqual(calls[0].images, [image]);
  assert.deepEqual(calls[0].context, { tags: ['@图片2'] });
  for (const word of ['@图片2', 'views', 'plainClothes', 'clothes', 'hair', '纯色打底']) assert.ok(calls[0].text.includes(word), word);
  assert.deepEqual(looks, { '@图片2': { views: 3, plainClothes: false, clothes: '橙色长袖工作服和橙色长裤', hair: '灰白色短发' } });
});

test('回话格式毛病能纠正就纠正：没写编号按顺序对上、次数乱写当 1、带编号或编辑词的描述丢掉、太长截断', async () => {
  const second = { ...person, tag: '@图片3', itemId: 'P2' };
  const ask = async () => ({ people: [
    { views: 0, plainClothes: 'true', clothes: '把衣服改成@图片3的样子', hair: '黑'.repeat(40) },
    { views: 'abc', plainClothes: 'no', clothes: '红'.repeat(90), hair: '去掉帽子的短发' }] });
  const looks = await lookPeople({ materials: [person, second], images: [image, image] }, { ask });
  assert.deepEqual(looks['@图片2'], { views: 1, plainClothes: true, clothes: '', hair: '黑'.repeat(20) });
  assert.deepEqual(looks['@图片3'], { views: 1, plainClothes: false, clothes: '红'.repeat(60), hair: '' });
});

test('回话里没有人物列表就报错（钱已花，不重发）', async () => {
  let calls = 0;
  const ask = async () => { calls++; return { answer: '一位老人' }; };
  await assert.rejects(lookPeople({ materials: [person], images: [image] }, { ask }), /看图回话不对/);
  assert.equal(calls, 1);
});

test('没有要换的人物图就不问、不花钱', async () => {
  let calls = 0;
  assert.deepEqual(await lookPeople({ materials: [], images: [] }, { ask: async () => { calls++; return {}; } }), {});
  assert.equal(calls, 0);
});

test('假看图：零花费，每张图给固定样子，转换后能直接用', async () => {
  const reply = await fakeLook({ context: { tags: ['@图片2', '@图片3'] } });
  assert.equal(reply.people.length, 2);
  const looks = await lookPeople({ materials: [person], images: [image] }, { ask: fakeLook });
  assert.equal(looks['@图片2'].views, 1); assert.equal(looks['@图片2'].plainClothes, false); assert.ok(looks['@图片2'].clothes);
});
