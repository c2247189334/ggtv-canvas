import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, planFromReply, scenePlaces, validatePlan } from './analyze.mjs';
import { checkRules, outfitChangePoints, planChangeSeconds, sceneItems } from './rules.mjs';
import { materialRoles } from './roles.mjs';
import { writePrompt } from './writePrompt.mjs';
import { tempDir } from '../testKit.mjs';

const person = (id, desc, where) => ({ id, kind: '人物', desc, from: 0, to: 15, frame: 0, ...(where ? { where } : {}) });
const cloth = (id, owner, desc, from, to) => ({ id, kind: '衣服', person: owner, desc, from, to, frame: from });
const scene = (id, desc, from, to) => ({ id, kind: '场景', desc, from, to, frame: (from + to) / 2 });
const planOf = (items, replace = []) => ({ summary: '拆解', items, changes: [], actions: [], replace, unsure: [] });

test('11-09 场景整理：AI 挑的 frame 在这段里才用，越界、没写、写成别的取段中；empty 只认 true；按开始时间排；写坏的丢掉', () => {
  const places = scenePlaces([{ id: 'S2', desc: '保龄球，深蓝', from: 6, to: 8, frame: '7.2', empty: 'TRUE' },
    { id: 'S1', desc: '白棚，白色', from: 0, to: 4, frame: 1.9, empty: true },
    { id: 'S3', desc: '高尔夫球，白色', from: 8, to: 10, frame: 3 }, { id: 'S4', desc: '网球，黄绿', from: 10, to: 12, frame: '一半', empty: 'yes' },
    { id: 'S5', desc: '', from: 4, to: 6 }, '坏的'], 12);
  assert.deepEqual(places.map(({ id, frame, empty }) => [id, frame, empty]), [['S1', 1.9, true], ['S2', 7.2, true], ['S3', 9, false], ['S4', 11, false]]);
  assert.deepEqual(scenePlaces(undefined, 12), []);
});

test('拆解单里的场景用挑好的帧当截图时刻，不带有没有人的标记', () => {
  const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 10 }], clothes: [], things: [], replace: [], unsure: [],
    scenes: [{ id: 'S1', desc: '红墙，朱红色', from: 0, to: 4, frame: 3.4, empty: true }, { id: 'S2', desc: '花墙，白色', from: 4, to: 10, frame: 20 }] }, 10);
  assert.deepEqual(sceneItems(plan).map(({ id, frame }) => [id, frame]), [['S1', 3.4], ['S2', 7]]);
  assert.ok(sceneItems(plan).every(item => !('empty' in item)));
  validatePlan(plan, 10);
});

test('拆解：两个以上场景才进改写单，取段中当截图时刻；要换的编号不能选场景', () => {
  const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 10 }], clothes: [], things: [], replace: ['P1', 'S1'], unsure: [],
    scenes: [{ id: 'S1', desc: '红墙，朱红色', from: 0, to: 4 }, { id: 'S2', desc: '花墙，白色', from: '4', to: 10 }] }, 10);
  assert.deepEqual(sceneItems(plan).map(({ id, from, to, frame }) => ({ id, from, to, frame })), [{ id: 'S1', from: 0, to: 4, frame: 2 }, { id: 'S2', from: 4, to: 10, frame: 7 }]);
  assert.deepEqual(plan.replace, ['P1']);
  assert.match(plan.summary, /2个场景/);
  assert.ok(plan.unsure.some(text => text.includes('S1')));
  validatePlan(plan, 10);
});

test('拆解：只有一个场景、没写、写坏都当单场景，不作废（钱已花）', () => {
  const base = { people: [{ id: 'P1', desc: '女生', from: 0, to: 10 }], clothes: [], things: [], replace: [], unsure: [] };
  assert.deepEqual(sceneItems(planFromReply({ ...base, scenes: [{ id: 'S1', desc: '公园', from: 0, to: 10 }] }, 10)), []);
  assert.deepEqual(sceneItems(planFromReply(base, 10)), []);
  const broken = planFromReply({ ...base, scenes: [{ id: 'S1', desc: '公园', from: 0, to: 5 }, { id: 'S2', desc: '', from: 5, to: 10 }, { id: 'S3', desc: '海边', from: 8, to: 8 }, '坏的'] }, 10);
  assert.deepEqual(sceneItems(broken), []);
  validatePlan(broken, 10);
});

test('拆解：衣服记住是谁的，人记住在哪半屏；太长的位置不收', () => {
  const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', where: '上半屏', from: 0, to: 10 }, { id: 'P2', desc: '男生', where: '这个人一直待在画面下面那一块里面', from: 0, to: 10 }],
    clothes: [{ id: 'C1', person: 'P1', desc: '婚纱', from: 0, to: 10 }], things: [], replace: [], unsure: [] }, 10);
  assert.equal(plan.items.find(item => item.id === 'C1').person, 'P1');
  assert.equal(plan.items.find(item => item.id === 'P1').where, '上半屏');
  assert.equal('where' in plan.items.find(item => item.id === 'P2'), false);
});

test('拆解提问：场景一律问（11-11 起换新背景也要按场景铺卡），转场不算新地方；人的位置都问', async () => {
  const folder = tempDir();
  const save = name => { writeFileSync(join(folder, name), 'jpeg'); return name; };
  const sheets = { timeline: async () => [save('timeline-0.jpg')], cuts: async () => [],
    frames: async (_input, times) => times.map((_, i) => save(`frame-${i}.jpg`)) };
  let asked = '';
  const reply = { people: [{ id: 'P1', desc: '女生', from: 0, to: 10 }], clothes: [], things: [], replace: [], unsure: [] };
  await analyze({ source: 'clip', folder, duration: 10, ratio: '9:16', width: 720, height: 1280, userText: '换人' },
    { sheets, ask: async ({ text }) => { asked = text; return reply; } });
  assert.match(asked, /scenes：/);
  assert.match(asked, /黑屏转场、人换衣服都不算新的一段/);
  assert.match(asked, /只回答下面五件事/);
  assert.match(asked, /scenes:\[\{id:S1起依次编号,desc,from:秒数,to:秒数,frame:秒数,empty:true或false\}\]/);
  assert.match(asked, /where/);
});

const twoScenes = () => {
  const plan = planOf([person('P1', '女生'), cloth('C1', 'P1', '大衣，棕色', 0, 7.6), cloth('C2', 'P1', '婚纱，白色', 7.6, 15),
    scene('S1', '红墙，朱红色', 0, 7.6), scene('S2', '花墙，白色', 7.6, 15)], ['P1']);
  const materials = [{ tag: '@图片1', purpose: '背景', itemId: 'S1' }, { tag: '@图片2', purpose: '背景', itemId: 'S2' },
    { tag: '@图片3', purpose: '人物', itemId: 'P1' }, { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }];
  return { plan, materials, duration: 15, ratio: '9:16', userText: '人物换掉' };
};

test('多场景：时间轴每段写清场景，换场单独占一秒段，结尾不再写死同一个场景', () => {
  const { videoPrompt } = writePrompt(twoScenes());
  assert.doesNotMatch(videoPrompt, /同一个场景/);
  assert.match(videoPrompt, /0-7秒：场景是@图片1，人物身穿大衣，棕色。/);
  // 11-11：衣服跟原片又没连图时每套原描述只在第一次出现写全，后面只写开头那个名字。
  assert.match(videoPrompt, /7-8秒：场景是@图片1，人物身穿大衣，随后场景是@图片2，人物身穿婚纱，白色，切换时机跟随@视频1。/);
  assert.match(videoPrompt, /8-15秒：场景是@图片2，人物身穿婚纱。/);
});

test('多场景：提示词过免费检查', () => {
  const input = twoScenes(), { videoPrompt } = writePrompt(input);
  assert.deepEqual(checkRules({ ...input, videoPrompt }), []);
});

test('多场景：只换地方不换衣服，换场点也单独占一秒段', () => {
  const plan = planOf([person('P1', '女生'), cloth('C1', 'P1', '大衣，棕色', 0, 15), scene('S1', '红墙', 0, 5.4), scene('S2', '花墙', 5.4, 15)], ['P1']);
  const input = { plan, materials: [{ tag: '@图片1', purpose: '背景', itemId: 'S1' }, { tag: '@图片2', purpose: '背景', itemId: 'S2' }, { tag: '@图片3', purpose: '人物', itemId: 'P1' }],
    duration: 15, ratio: '9:16', userText: '衣服不换，只换脸' };
  const { videoPrompt } = writePrompt(input);
  assert.match(videoPrompt, /5-6秒：场景是@图片1，.*随后场景是@图片2/);
  assert.deepEqual(planChangeSeconds(plan), [5.4]);
  assert.deepEqual(checkRules({ ...input, videoPrompt }), []);
});

test('多场景：一张背景都没连时用拆解的描述顶上，不写 undefined', () => {
  const input = { ...twoScenes(), materials: [{ tag: '@图片1', purpose: '人物', itemId: 'P1' }] };
  const { videoPrompt } = writePrompt(input);
  assert.match(videoPrompt, /场景是红墙/);
  assert.doesNotMatch(videoPrompt, /undefined/);
});

const couple = () => {
  const plan = planOf([person('P1', '女生', '上半屏'), person('P2', '男生', '下半屏'),
    cloth('C1', 'P1', '大衣，棕色', 0, 3.8), cloth('C2', 'P2', '大衣，黑色', 0, 3.8), cloth('C3', 'P1', '汉服，浅绿', 3.8, 15), cloth('C4', 'P2', '长袍，淡蓝', 3.6, 15),
    scene('S1', '灰色影棚', 0, 3.8), scene('S2', '红墙', 3.8, 15)], ['P1', 'P2']);
  return { plan, duration: 15, ratio: '9:16', userText: '两个人都换掉',
    materials: [{ tag: '@图片1', purpose: '背景', itemId: 'S1' }, { tag: '@图片2', purpose: '背景', itemId: 'S2' }, { tag: '@图片3', purpose: '人物 1', itemId: 'P1' },
      { tag: '@图片4', purpose: '人物 2', itemId: 'P2' }, { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }] };
};

test('两个人：谁穿哪件分开写，同一秒先后换也不丢人', () => {
  const { videoPrompt } = writePrompt(couple());
  assert.match(videoPrompt, /0-3秒：场景是@图片1，@图片3身穿大衣，棕色，@图片4身穿大衣，黑色。/);
  assert.match(videoPrompt, /3-4秒：场景是@图片1，@图片3身穿大衣，@图片4身穿大衣，随后场景是@图片2，@图片3身穿汉服，浅绿，@图片4身穿长袍，淡蓝/);
  assert.match(videoPrompt, /全程这2个人/);
  assert.doesNotMatch(videoPrompt, /和大衣/);
});

test('两个人一个场景：结尾写这几个人，不写同一个人', () => {
  const plan = planOf([person('P1', '女生'), person('P2', '男生'), cloth('C1', 'P1', '大衣', 0, 15), cloth('C2', 'P2', '西装', 0, 15)], ['P1', 'P2']);
  const { videoPrompt } = writePrompt({ plan, duration: 15, ratio: '9:16', userText: '换人',
    materials: [{ tag: '@图片1', purpose: '人物 1', itemId: 'P1' }, { tag: '@图片2', purpose: '人物 2', itemId: 'P2' }] });
  assert.match(videoPrompt, /全程这2个人、同一个场景和光线，不要字幕。/);
  assert.doesNotMatch(videoPrompt, /同一个人/);
});

test('多角度人物图一律写「只算一个人」，不写「画面里只出现这一个人」（11-08 两个人；11-10 一个人也改：2.5 支持多视图，原片有分身时那句会打架）', () => {
  const plan = planOf([person('P1', '女生'), person('P2', '男生')], ['P1', 'P2']);
  const materials = [{ tag: '@图片1', purpose: '人物 1', itemId: 'P1' }, { tag: '@图片2', purpose: '人物 2', itemId: 'P2' }];
  const looks = { '@图片1': { views: 4 }, '@图片2': { views: 3 } };
  const two = materialRoles({ plan, materials }, { looks });
  assert.match(two, /图里4个身影是同一个人的不同角度，只算一个人。/); assert.match(two, /图里3个身影是同一个人的不同角度，只算一个人。/);
  assert.doesNotMatch(two, /只出现这一个人/);
  const one = materialRoles({ plan: planOf([person('P1', '女生')], ['P1']), materials: [materials[0]] }, { looks });
  assert.match(one, /图里4个身影是同一个人的不同角度，只算一个人。/); assert.doesNotMatch(one, /只出现这一个人/);
});

test('分屏：素材职责按上下半屏说谁是谁，动作参考里的人对得上', () => {
  const input = couple(), roles = materialRoles(input);
  assert.match(roles, /@视频1里的上半屏的人就是@图片3，下半屏的人就是@图片4/);
  const mesh = materialRoles({ ...input, materials: input.materials.map(row => row.tag === '@视频1' ? { ...row, purpose: '白模，参考人物动作、姿态、位置和机位' } : row) });
  assert.match(mesh, /上半屏的灰色人体模型就是@图片3，下半屏的灰色人体模型就是@图片4/);
});

test('旧拆解单：衣服没记是谁的，照旧写一句；有换装点结尾不写死同一个场景（11-11 婚礼换装就换地方）', () => {
  const plan = planOf([person('P1', '女生'), { ...cloth('C1', 'P1', '大衣', 0, 7), person: undefined }, { ...cloth('C2', 'P1', '婚纱', 7, 15), person: undefined }], ['P1']);
  const { videoPrompt } = writePrompt({ plan, duration: 15, ratio: '9:16', userText: '人物换掉', materials: [{ tag: '@图片1', purpose: '人物', itemId: 'P1' }] });
  assert.match(videoPrompt, /0-7秒：人物身穿大衣。/);
  assert.match(videoPrompt, /7-8秒：人物身穿大衣，随后身穿婚纱。/);
  assert.match(videoPrompt, /\n全程同一个人，不要字幕。$/);
});

test('两个人第一套衣服开始时间差一点：不算换装，开头不多出一段（11-06 真拆婚礼视频 0.2 和 0.4 秒）', () => {
  const plan = planOf([person('P1', '女生'), person('P2', '男生'), cloth('C1', 'P1', '大衣', 0.4, 7), cloth('C2', 'P2', '西装', 0.2, 7),
    cloth('C3', 'P1', '婚纱', 7, 15), cloth('C4', 'P2', '礼服', 7, 15)], ['P1', 'P2']);
  assert.deepEqual(outfitChangePoints(plan).map(point => point.second), [7]);
  const { videoPrompt } = writePrompt({ plan, duration: 15, ratio: '9:16', userText: '换人',
    materials: [{ tag: '@图片1', purpose: '人物 1', itemId: 'P1' }, { tag: '@图片2', purpose: '人物 2', itemId: 'P2' }] });
  assert.match(videoPrompt, /0-7秒：@图片1身穿大衣，@图片2身穿西装。/);
  assert.doesNotMatch(videoPrompt, /0-1秒/);
});
