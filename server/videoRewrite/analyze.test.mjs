import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, planFromReply, uniqueItemIds, unsureList, validatePlan } from './analyze.mjs';
import { fakeRound } from './fake.mjs';
import { tempDir } from '../testKit.mjs';

const fakeSheets = (folder, names = ['timeline-0.jpg'], cuts = []) => {
  for (const name of names) writeFileSync(join(folder, name), 'jpeg');
  const calls = [], frameCalls = [];
  return { calls, frameCalls, sheets: {
    timeline: async input => { calls.push(input); return names; }, cuts: async () => cuts,
    frames: async (input, times) => { frameCalls.push(times); return times.map((_, i) => { writeFileSync(join(input.folder, `frame-${i}.jpg`), 'jpeg'); return `frame-${i}.jpg`; }); }
  } };
};
const run = (sheets, ask, patch = {}) => analyze({ source: 'clip', folder: patch.folder, duration: 15.05, ratio: '9:16', width: 720, height: 1280, userText: '换人换衣', ...patch }, { sheets, ask });

// 10-30 真豆包窄拆解原话（吊扇，照草稿区 s2-fan-2 抄，desc 略短）。
const realNarrowReply = () => ({
  people: [{ id: 'P1', desc: '年轻女性，棕色长卷发', from: 0, to: 15.047 }],
  clothes: [{ id: 'C1', person: 'P1', desc: '短款立领连衣裙，深蓝色丝绒材质', from: 0, to: 5.8 },
    { id: 'C2', person: 'P1', desc: '吊带超短连衣裙，上粉下橙渐变亮片', from: 5.8, to: 9.2 },
    { id: 'C3', person: 'P1', desc: '露肩吊带长裙，米白色缎面', from: 9.2, to: 12.6 },
    { id: 'C4', person: 'P1', desc: '方领短袖鱼尾长裙，深藏蓝色丝绒', from: 12.6, to: 15.047 }],
  things: [{ id: 'D1', desc: '遥控器，黑色长条形，表面有多颗按键' }, { id: 'D2', desc: '吊扇叶片，深棕色木质，带有银灰色金属固定件' }],
  replace: ['P1', 'C1', 'C2', 'C3', 'C4'], unsure: []
});

test('10-30 窄拆解回话转成改写单：人 / 衣服 / 东西分别成项，东西占全片，frame 取开始秒，没有动作和变化', () => {
  const plan = planFromReply(realNarrowReply(), 15.047);
  assert.deepEqual(plan.items.map(item => [item.id, item.kind, item.from, item.to, item.frame]), [
    ['P1', '人物', 0, 15.047, 0], ['C1', '衣服', 0, 5.8, 0], ['C2', '衣服', 5.8, 9.2, 5.8], ['C3', '衣服', 9.2, 12.6, 9.2],
    ['C4', '衣服', 12.6, 15.047, 12.6], ['D1', '道具', 0, 15.047, 0], ['D2', '道具', 0, 15.047, 0]]);
  assert.equal(plan.items.find(item => item.id === 'D2').desc, '吊扇叶片，深棕色木质，带有银灰色金属固定件');
  assert.deepEqual(plan.replace, ['P1', 'C1', 'C2', 'C3', 'C4']);
  assert.deepEqual([plan.actions, plan.changes, plan.unsure], [[], [], []]);
  assert.ok(plan.summary.trim());
  assert.doesNotThrow(() => validatePlan(plan, 15.047));
});

test('回话格式毛病能纠正就纠正（钱已花）：秒数写成字符串转数字、越界夹回时长内、人没写时段算全片、replace 写成一段字也认', () => {
  const reply = realNarrowReply();
  reply.people[0] = { id: 'P1', desc: '年轻女性' };
  reply.clothes[0].from = '0'; reply.clothes[0].to = '5.8'; reply.clothes[3].to = 15.2;
  reply.replace = 'P1、C1,C2，C3 C4';
  const plan = planFromReply(reply, 15.047);
  assert.deepEqual(plan.items.find(item => item.id === 'P1'), { id: 'P1', kind: '人物', desc: '年轻女性', from: 0, to: 15.047, frame: 0 });
  assert.deepEqual([plan.items[1].from, plan.items[1].to, plan.items[4].to], [0, 5.8, 15.047]);
  assert.deepEqual(plan.replace, ['P1', 'C1', 'C2', 'C3', 'C4']);
  assert.doesNotThrow(() => validatePlan(plan, 15.047));
});

test('replace 里不存在或重复的编号去掉并写进 unsure，不作废整单', () => {
  const plan = planFromReply({ ...realNarrowReply(), replace: ['P1', 'S1', 'C1', 'C1'], unsure: ['开头有点暗'] }, 15.047);
  assert.deepEqual(plan.replace, ['P1', 'C1']);
  assert.deepEqual(plan.unsure, ['开头有点暗', '要换的编号 S1 在拆解结果里不存在，已忽略']);
});

test('三类里编号撞了（如人和东西都叫 P1）照样出单：后一个改名，要换的仍指第一个', async () => {
  const folder = tempDir(), { sheets } = fakeSheets(folder);
  const reply = { ...realNarrowReply(), things: [{ id: 'P1', desc: '遥控器，黑色' }] };
  const { plan } = await run(sheets, async () => reply, { folder });
  assert.deepEqual(plan.items.map(item => item.id), ['P1', 'C1', 'C2', 'C3', 'C4', 'P1_2']);
  assert.equal(plan.items.find(item => item.id === 'P1').kind, '人物');
  assert.equal(reply.things[0].id, 'P1', '不动豆包原话');
  const fixed = uniqueItemIds({ items: [{ id: 'P1' }, { id: 'P1' }, { id: 'P1_2' }], replace: ['P1'] });
  assert.deepEqual(fixed.items.map(item => item.id), ['P1', 'P1_3', 'P1_2']);
});

test('unsure 写成一段文字包成一项；空文字、没写、null 当没有；数组里不是文字的照样被拒', async () => {
  const folder = tempDir(), { sheets } = fakeSheets(folder);
  const { plan } = await run(sheets, async () => ({ ...realNarrowReply(), unsure: '柜子上那团灰的看不清' }), { folder });
  assert.deepEqual(plan.unsure, ['柜子上那团灰的看不清']);
  for (const unsure of ['', '  ', null, undefined]) assert.deepEqual(unsureList({ unsure }).unsure, []);
  assert.throws(() => validatePlan(unsureList({ ...planFromReply(realNarrowReply(), 15.047), unsure: [3] }), 15.047), /unsure每项/);
});

test('只问一次：总览大图 + 均分取段中的 6 张清楚大帧，最高清晰度、高档思考；单次最多 12 张图', async () => {
  const folder = tempDir(), { calls, frameCalls, sheets } = fakeSheets(folder, ['timeline-0.jpg'], [5.5]);
  const asks = [];
  const result = await run(sheets, async input => { asks.push(input); return fakeRound(input); }, { folder });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].detail, 'xhigh'); assert.equal(asks[0].effort, 'high');
  assert.equal(asks[0].images.length, 7);
  assert.ok(asks[0].images.every(image => image.startsWith('data:image/jpeg;base64,')));
  assert.deepEqual(frameCalls, [[1.3, 3.8, 6.3, 8.8, 11.3, 13.8]]);
  assert.match(asks[0].text, /另附6张原片清楚大图，依次是1\.3、3\.8、6\.3、8\.8、11\.3、13\.8秒的画面/);
  assert.deepEqual(asks[0].context.cuts, [5.5]);
  assert.deepEqual(calls.map(x => [x.width, x.height, x.duration]), [[720, 1280, 15.05]]);
  assert.deepEqual(Object.keys(result).sort(), ['cuts', 'plan']);
  const manyFolder = tempDir(), many = fakeSheets(manyFolder, Array.from({ length: 8 }, (_, i) => `timeline-${i}.jpg`));
  const more = [];
  await run(many.sheets, async input => { more.push(input); return fakeRound(input); }, { folder: manyFolder });
  assert.equal(more[0].images.length, 12); assert.equal(many.frameCalls[0].length, 4);
  assert.match(more[0].text, /共8张/);
});

test('10-30 窄问法：只问人、每套衣服起止、东西名字外观、要换谁；名字结合总览图里怎么动来认；不问镜头动作动静；不带测试视频的例子', async () => {
  const folder = tempDir(), { sheets } = fakeSheets(folder);
  let sent;
  await run(sheets, async input => { sent = input; return fakeRound(input); }, { folder });
  for (const word of ['每0.2秒一帧', '每行10帧', '只回答下面四件事', 'people', 'clothes', 'things', 'replace', 'unsure', '通用称呼', '通用名称',
    '起止秒数', '不拆成多套', '镜头、场景、动作、东西怎么动都不用写', '结合它在总览大图里怎么动', '只拍到某一瞬间', '不要猜成别的']) {
    assert.ok(sent.text.includes(word), word);
  }
  for (const word of ['actions', 'states', 'before', 'summary', '开关', '机器', '吊扇', '扇叶', '遥控', '变装', '击球', '挥杆', '高尔夫', '猫']) {
    assert.ok(!sent.text.includes(word), `不该出现：${word}`);
  }
});

test('坏回话直接失败不重发，错误里保留豆包原话', async () => {
  const folder = tempDir(), { sheets } = fakeSheets(folder);
  let calls = 0;
  await assert.rejects(run(sheets, async () => { calls++; return { people: [], clothes: [], things: [], note: '回话原文用于查错' }; }, { folder }),
    /改写单[\s\S]*回话原文用于查错/);
  assert.equal(calls, 1);
  await assert.rejects(run(sheets, async () => ({ ...realNarrowReply(), clothes: [{ id: 'C1', desc: '' }] }), { folder }), /改写单/);
});

test('改写单校验：动作和变化可以空（10-30 起不问）；字段、类型、越界、重复 id、不存在的 replace 照样拒；旧单子带 states / actions 照收', () => {
  const good = planFromReply(realNarrowReply(), 15.047);
  for (const mutate of [x => delete x.summary, x => x.items = [], x => x.items[0].kind = '鞋', x => x.items[0].from = -1,
    x => x.items[0].to = 16, x => x.items[0].frame = 17, x => x.items[1].id = x.items[0].id, x => x.replace = ['missing'],
    x => x.changes = [{ second: 16, how: '越界' }], x => x.actions = [{ from: 0, to: 20, desc: '越界' }], x => x.unsure = '没有', x => x.items[0].id = '../x']) {
    const invalid = structuredClone(good); mutate(invalid);
    assert.throws(() => validatePlan(invalid, 15.047), /改写单/);
  }
  const old = structuredClone(good);
  old.actions = [{ from: 0, to: 15, desc: '躺着' }]; old.changes = [{ second: 5.8, how: '换装' }]; old.items[6].states = [{ from: 0, to: 4.4, state: '静止' }];
  assert.doesNotThrow(() => validatePlan(old, 15.047));
});

test('假模式一人四衣一样东西，4~30秒都夹住', async () => {
  for (const duration of [4, 6, 15.05, 30]) {
    const plan = planFromReply(await fakeRound({ context: { duration } }), duration);
    validatePlan(plan, duration);
    assert.deepEqual(plan.items.map(item => item.kind), ['人物', '衣服', '衣服', '衣服', '衣服', '道具']);
    if (duration === 15.05) assert.deepEqual(plan.items.filter(x => x.kind === '衣服').map(x => [x.from, x.to]), [[0, 5.5], [5.5, 9], [9, 12.5], [12.5, 15.05]]);
  }
  await assert.rejects(fakeRound({ context: { duration: 15, userText: '假拆解失败' } }), /假拆解失败/);
});
