import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, planFromReply, validatePlan } from './analyze.mjs';
import { fakeRound } from './fake.mjs';
import { checkPromptInput } from './input.mjs';
import { materialRoles } from './roles.mjs';
import { checkRules, planChangeSeconds } from './rules.mjs';
import { personOutfit, writePrompt } from './writePrompt.mjs';
import { tempDir } from '../testKit.mjs';

const person = (id, desc, where) => ({ id, kind: '人物', desc, from: 0, to: 12, frame: 0, ...(where ? { where } : {}) });
const cloth = (id, owner, desc, from, to, sameAs) => ({ id, kind: '衣服', person: owner, desc, from, to, frame: (from + to) / 2, ...(sameAs ? { sameAs } : {}) });
const scene = (id, desc, from, to) => ({ id, kind: '场景', desc, from, to, frame: (from + to) / 2 });
const planOf = (items, replace) => ({ summary: '拆解', items, changes: [], actions: [], replace, unsure: [] });
const wedding = (replace = ['P1', 'P2']) => planOf([person('P1', '女生', '上半屏'), person('P2', '男生', '下半屏'),
  cloth('C1', 'P1', '休闲外套,棕色连帽长外套', 0, 4), cloth('C2', 'P1', '中式喜服,红色绣金花纹', 4, 8), cloth('C3', 'P1', '休闲外套,棕色连帽长外套', 8, 12, 'C1'),
  cloth('C4', 'P2', '呢子大衣,深灰黑色宽松大衣', 0, 4), cloth('C5', 'P2', '红色圆领袍,绣金龙纹', 4, 8), cloth('C6', 'P2', '呢子大衣,深灰黑色宽松大衣', 8, 12, 'C4'),
  scene('S1', '摄影棚', 0, 4), scene('S2', '宫墙', 4, 8), scene('S3', '草坪', 8, 12)], replace);
const material = (tag, plan, id) => {
  const item = plan.items.find(entry => entry.id === id);
  return { tag, purpose: item.kind === '场景' ? '背景' : item.kind, itemId: id, ...(item.kind === '场景' ? {} : { originalDesc: item.desc }), asset: { type: 'work', id: '12345678-1234-1234-1234-123456789abc' } };
};
const depth = { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' };
function input(plan = wedding(), ids = ['S1', 'S2', 'S3', 'P1', 'P2', 'C1', 'C2', 'C4', 'C5']) {
  return { plan, materials: [...ids.map((id, index) => material(`@图片${index + 1}`, plan, id)), depth], duration: 12, sourceDuration: 12, ratio: '9:16', userText: '换人', keepClothes: true };
}

test('拆解：记下每套衣服最清楚的一帧，写错取这段中间', () => {
  const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 12 }], things: [], replace: [], unsure: [], clothes: [
    { id: 'C1', person: 'P1', desc: '外套', from: 0, to: 4, frame: '2.6' }, { id: 'C2', person: 'P1', desc: '婚纱', from: 4, to: 8, frame: 11 }, { id: 'C3', person: 'P1', desc: '喜服', from: 8, to: 12 }] }, 12);
  assert.deepEqual(plan.items.filter(item => item.kind === '衣服').map(item => item.frame), [2.6, 6, 10]);
  validatePlan(plan, 12);
});

test('拆解：sameAs 只认前面同一个人的衣服，连环指向归到第一套，写错就当不同的衣服', () => {
  const plan = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 12 }, { id: 'P2', desc: '男生', from: 0, to: 12 }], things: [], replace: [], unsure: [], clothes: [
    { id: 'C1', person: 'P1', desc: '婚纱', from: 0, to: 2 }, { id: 'C2', person: 'P1', desc: '喜服', from: 2, to: 4 },
    { id: 'C3', person: 'P1', desc: '婚纱', from: 4, to: 6, sameAs: 'C1' }, { id: 'C4', person: 'P1', desc: '婚纱', from: 6, to: 8, sameAs: 'C3' },
    { id: 'C5', person: 'P2', desc: '西装', from: 8, to: 10, sameAs: 'C1' }, { id: 'C6', person: 'P1', desc: '喜服', from: 10, to: 12, sameAs: 'C9' }] }, 12);
  const sameAs = Object.fromEntries(plan.items.filter(item => item.kind === '衣服').map(item => [item.id, item.sameAs]));
  assert.deepEqual(sameAs, { C1: undefined, C2: undefined, C3: 'C1', C4: 'C1', C5: undefined, C6: undefined });
});

test('拆解提问：要最清楚的一帧和同一套衣服', async () => {
  const folder = tempDir();
  const save = name => { writeFileSync(join(folder, name), 'jpeg'); return name; };
  const sheets = { timeline: async () => [save('timeline-0.jpg')], cuts: async () => [],
    frames: async (_input, times) => times.map((_, i) => save(`frame-${i}.jpg`)) };
  let question = '';
  await analyze({ source: 'a.mp4', folder, duration: 12, ratio: '9:16', userText: '换人' }, { sheets, ask: async ({ text }) => {
    question = text;
    return { people: [{ id: 'P1', desc: '女生', from: 0, to: 12 }], clothes: [], things: [], replace: [], unsure: [] };
  } });
  assert.match(question, /frame写这套衣服露得最全最清楚的一帧/);
  assert.match(question, /sameAs写前面那项的id/);
  assert.match(question, /这个人大部分时间在其中一块时，where写在哪块.*结尾或中途短暂跨到别的块也照写/);
  assert.match(question, /clothes:\[\{[^}]*frame:秒数,sameAs/);
});

test('提示词：衣服保持原片时写衣服图编号，同一套重复用一张图，两个人分开写，全部过规则检查', () => {
  const body = input(), { videoPrompt, warnings } = writePrompt(body);
  assert.match(videoPrompt, /0-4秒：场景是@图片1，@图片4身穿@图片6的衣服，@图片5身穿@图片8的衣服。/);
  assert.match(videoPrompt, /5-8秒：场景是@图片2，@图片4身穿@图片7的衣服，@图片5身穿@图片9的衣服。/);
  assert.match(videoPrompt, /9-12秒：场景是@图片3，@图片4身穿@图片6的衣服，@图片5身穿@图片8的衣服。/);
  assert.doesNotMatch(videoPrompt, /棕色|呢子|喜服|圆领袍/);
  assert.deepEqual(warnings, []);
  assert.deepEqual(checkRules({ ...body, videoPrompt, changeSeconds: planChangeSeconds(body.plan) }), []);
});

test('素材职责：原片衣服图要写清头冠帽子要戴上、人台不要；深度不再排除衣服轮廓', () => {
  const text = materialRoles(input());
  assert.match(text, /@图片6是第1套衣服（0-4秒穿）：采用衣服和配饰的款式、长短、颜色、花纹和材质，图里有头冠或帽子就戴在头上，不采用图中的人台、支架和背景。/);
  assert.match(text, /不采用其中的灰度画面、发型；/);
  assert.doesNotMatch(text.split('\n').at(-1), /衣服轮廓/);
});

test('素材职责：有一件衣服写明要换，那件用换衣服那句（11-11 配件照图穿戴），深度照旧排除衣服轮廓', () => {
  const body = input(wedding(['P1', 'P2', 'C1'])), text = materialRoles(body);
  assert.match(text, /@图片6是第1套衣服（0-4秒穿）：采用衣服和配饰的款式、长短、颜色、花纹和材质，图里的帽子、鞋袜、手套照图穿戴，不采用图中的人台、模特和背景。/);
  assert.match(text, /@图片7是第3套衣服（4-8秒穿）：采用衣服和配饰/);
  assert.match(text.split('\n').at(-1), /和衣服轮廓/);
});

test('衣服卡被删了：那件退回文字描述，不写空编号，也不报错', () => {
  const body = input(wedding(), ['S1', 'S2', 'S3', 'P1', 'P2', 'C1', 'C4', 'C5']), { videoPrompt } = writePrompt(body);
  assert.match(videoPrompt, /@图片4身穿中式喜服,红色绣金花纹/);
  assert.deepEqual(checkRules({ ...body, videoPrompt, changeSeconds: planChangeSeconds(body.plan) }), []);
});

test('一个人只写换人、勾了衣服保持原片：就算人物图穿着衣服，也不穿人物图那身', () => {
  const plan = planOf([person('P1', '女生'), cloth('C1', 'P1', '舞蹈服,黑红色', 0, 12)], ['P1']);
  const materials = [{ ...material('@图片1', plan, 'P1') }, { ...material('@图片2', plan, 'C1') }, depth];
  const looks = { '@图片1': { views: 1, plainClothes: false, clothes: '灰色西装', hair: '白色短发' } };
  assert.equal(personOutfit({ plan, materials: [materials[0], depth], userText: '换人', keepClothes: true }, looks), null);
  const { videoPrompt } = writePrompt({ plan, materials, duration: 12, ratio: '9:16', userText: '换人', keepClothes: true }, looks);
  assert.match(videoPrompt, /人物身穿@图片2的衣服/);
  assert.doesNotMatch(videoPrompt, /灰色西装/);
  assert.notEqual(personOutfit({ plan, materials: [materials[0], depth], userText: '换人' }, looks), null);
});

test('交提示词：keepClothes 只收 true', () => {
  const body = { ...input(), cardId: 'card-1' };
  assert.equal(checkPromptInput(body).keepClothes, true);
  assert.equal('keepClothes' in checkPromptInput({ ...body, keepClothes: 'yes' }), false);
});

test('假拆解：原话写「假只换人」只换人，分屏，第 4 套和第 2 套是同一套', async () => {
  const reply = await fakeRound({ context: { duration: 15, userText: '假只换人' } });
  assert.deepEqual(reply.replace, ['P1']);
  assert.equal(reply.people[0].where, '上半屏');
  assert.equal(reply.clothes[3].sameAs, 'C2');
  assert.deepEqual((await fakeRound({ context: { duration: 15, userText: '换人和衣服' } })).replace, ['P1', 'C1', 'C2', 'C3', 'C4']);
});
