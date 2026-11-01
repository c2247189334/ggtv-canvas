import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRules, outfitChangeSeconds } from './rules.mjs';
import { MAX_PROMPT } from '../jobInput.mjs';

const materials = [{ tag: '@图片1', purpose: '人物' }, { tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' }];
const prompt = '@图片1提供人物形象；@视频1参考机位、动作、空间和遮挡节奏，里面的人就是@图片1，颜色材质不参考，全程彩色；@音频1是背景音乐，动作节奏跟随它。\n女生展示服装。\n0-6秒：转身。\n6-15秒：站立，第9秒身穿长裙。\n固定机位，室内柔光。';
const check = (videoPrompt = prompt, extra = {}) => checkRules({ videoPrompt, materials, duration: 15, ...extra });
const outfit = (id, from, to) => ({ id, kind: '衣服', desc: id, from, to, frame: from });

test('完整提示词和整数秒首尾相接通过；小数源时长四舍五入（15.05 秒按 15 秒，设计第 11 节）', () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(check(prompt, { duration: 15.05 }), []);
  assert.ok(check(prompt.replace('6-15秒', '6-16秒'), { duration: 15.05 }).some(x => /最后一段必须到15秒/.test(x)));
  assert.deepEqual(check(prompt.replace('6-15秒', '6-16秒'), { duration: 15.6 }), []);
});
for (const [name, text, pattern] of [
  ['空轴', '女生站立', /时间轴/], ['小数秒', prompt.replace('0-6秒', '0-6.5秒'), /整数秒/],
  ['非零开头', prompt.replace('0-6秒', '1-6秒'), /从0/], ['断开', prompt.replace('6-15秒', '7-15秒'), /相接/],
  ['重叠', prompt.replace('6-15秒', '5-15秒'), /相接/], ['缺结尾', prompt.replace('6-15秒', '6-14秒'), /最后/],
  ['反向', prompt.replace('6-15秒', '6-5秒'), /大于/]
]) test(`时间轴拒绝${name}`, () => assert.ok(check(text).some(x => pattern.test(x))));
for (const word of ['编辑视频', '增加', '加上', '删除', '去掉', '修改', '替换', '改成']) {
  test(`触发词${word}即报`, () => assert.ok(check(`${prompt}${word}`).some(x => x.includes(word))));
}
test('长度边界及引用双向检查', () => {
  assert.deepEqual(check(prompt.padEnd(MAX_PROMPT, '。')), []);
  assert.ok(check(prompt.padEnd(MAX_PROMPT + 1, '。')).some(x => /太长/.test(x)));
  for (const tag of materials.map(x => x.tag)) assert.ok(check(prompt.replaceAll(tag, '')).some(x => x.includes(tag)));
  for (const tag of ['@图片2', '@视频3', '@音频4']) assert.ok(check(prompt + tag).some(x => x.includes(tag) && /不存在/.test(x)));
});
test('音频每条都要写用途，没有音轨无需音频', () => {
  assert.ok(check(prompt.replace('@音频1是背景音乐，动作节奏跟随它。', '@音频1。')).some(x => /音频1.*用途/.test(x)));
  assert.deepEqual(check(prompt.replace('@音频1是背景音乐，动作节奏跟随它。', ''), { materials: materials.slice(0, 2) }), []);
  assert.ok(check(prompt + '@音频2。', { materials: [...materials, { tag: '@音频2', purpose: '音色' }] }).some(x => /音频2.*用途/.test(x)));
});

test('深度的每个编号都要在同一句写机位和动作，别处提到不算', () => {
  for (const missing of ['机位、', '动作、']) {
    assert.ok(check(prompt.replace(missing, '')).some(x => /视频1.*机位.*动作/.test(x)));
  }
  assert.ok(check(prompt.replace('@视频1参考机位、动作、空间和遮挡节奏', '@视频1参考空间和遮挡节奏；机位和动作')).some(x => /视频1.*机位.*动作/.test(x)));
  assert.ok(check(prompt + '@视频2提供空间。', { materials: [...materials, { tag: '@视频2', purpose: '深度动作' }] }).some(x => /视频2.*机位.*动作/.test(x)));
  assert.deepEqual(check(prompt.replace('@视频1参考机位、动作、空间和遮挡节奏', '@视频1提供空间'), { materials: materials.map(x => x.tag === '@视频1' ? { ...x, purpose: '场景参考' } : x) }), []);
});

test('每处字幕只接受不要字幕，混有其他字幕说法也拒绝', () => {
  assert.deepEqual(check(prompt + '不要字幕。'), []);
  assert.deepEqual(check(prompt + '画面里不要字幕。'), []);
  for (const text of ['无错误字幕', '无字幕', '添加字幕', '不要字幕。字幕清晰', '不要字幕错误']) {
    assert.ok(check(prompt + text).some(x => /字幕/.test(x)), text);
  }
});

test('每个变化点必须单独占floor(t)到floor(t)+1秒，免费检查和写词共用', () => {
  const isolated = prompt.replace('0-6秒：转身。\n6-15秒：站立，第9秒身穿长裙。', '0-5秒：站立。\n5-6秒：吊扇叶扫过挡住人的瞬间，身穿红裙。\n6-9秒：展示红裙。\n9-10秒：扇叶挡住人的瞬间，身穿长裙。\n10-15秒：展示长裙。');
  assert.deepEqual(check(isolated, { changeSeconds: [5.5, 9] }), []);
  const outfits = [outfit('C1', 0, 5.5), outfit('C2', 5.5, 9), outfit('C3', 9, 15)];
  for (const extra of [{ changeSeconds: [5.5, 9] }, { plan: { items: outfits, changes: [] } }]) {
    assert.ok(check(prompt, extra).some(x => /9-10秒/.test(x)));
  }
  assert.ok(!check(prompt, { changeSeconds: [15] }).some(x => /变化点/.test(x)), '正好在结尾的变化点没有后一秒，不要求单独一段');
});

test('10-29：只有换装点单独占一秒段（按衣服时段算）；10-26 真拆解把0秒、1秒的动作变化也写进changes，不再强求0-1、1-2秒段', () => {
  const plan = { items: [outfit('C2', 5.8, 8.8), outfit('C1', 0, 5.6), outfit('C3', 9, 12.2), outfit('C4', 12.4, 15),
    { id: 'O1', kind: '遮挡物', desc: '吊扇叶片', from: 0, to: 15, frame: 5 }],
    changes: [0, 1, 5.8, 9, 12.4].map(second => ({ second, how: '变化' })) };
  assert.deepEqual(outfitChangeSeconds(plan), [5.8, 9, 12.4]);
  const timeline = prompt.replace('0-6秒：转身。\n6-15秒：站立，第9秒身穿长裙。',
    '0-5秒：躺下。\n5-6秒：换第2套。\n6-9秒：第2套。\n9-10秒：换第3套。\n10-12秒：第3套。\n12-13秒：换第4套。\n13-15秒：第4套。');
  assert.deepEqual(check(timeline, { plan }), []);
  assert.ok(check(prompt, { plan }).some(x => /12-13秒/.test(x)));
  // 上下装同时出现时，第一套开始的秒数不算换装；没有衣服就没有换装点。
  assert.deepEqual(outfitChangeSeconds({ items: [outfit('top', 1, 15), outfit('bottom', 1, 6), outfit('bottom2', 6, 15)] }), [6]);
  assert.deepEqual(outfitChangeSeconds({ items: [{ id: 'P1', kind: '人物', desc: '人', from: 0, to: 15, frame: 1 }] }), []);
});

test('10-29 真跑新拆解：衣服2写成6秒才开始、换装点写5.8秒（实际约5.8秒换）——上一套结束前0.3秒到新一套开始之间有changes就用它，没有才用新一套开始秒数', () => {
  const plan = { items: [outfit('C1', 0, 5.8), outfit('C2', 6, 8.8), outfit('C3', 9.2, 12.4), outfit('C4', 12.6, 15)],
    changes: [1, 4.8, 5.8, 9, 12.6].map(second => ({ second, how: '变化' })) };
  assert.deepEqual(outfitChangeSeconds(plan), [5.8, 9, 12.6]);
  assert.deepEqual(outfitChangeSeconds({ ...plan, changes: [{ second: 4.8, how: '吊扇开始转' }] }), [6, 9.2, 12.6], '窗口外的动作变化不算');
});

test('背景图（用途以「背景」开头）必须在编号同一句写「场景」', () => {
  const withBackground = [materials[0], { tag: '@图片2', purpose: '背景：原视频里没有人的场景画面' }, ...materials.slice(1)];
  const good = prompt.replace('@图片1提供人物形象；', '@图片1提供人物形象；@图片2是场景，房间布置、颜色材质和光线照它；');
  assert.deepEqual(check(good, { materials: withBackground }), []);
  const vague = prompt.replace('@图片1提供人物形象；', '@图片1提供人物形象；@图片2是参考图；室内场景。');
  assert.ok(check(vague, { materials: withBackground }).some(x => /@图片2.*场景/.test(x)));
});

test('只忽略职责括号里的穿着时段，正文秒后直接写穿仍检查整数、首尾与重叠', () => {
  const one = [{ tag: '@图片1', purpose: '衣服' }];
  const run = videoPrompt => checkRules({ videoPrompt, materials: one, duration: 15 });
  assert.deepEqual(run('@图片1是衣服。0-5秒穿@图片1的衣服。5-15秒：站立。'), []);
  const bad = run('@图片1是衣服。0-15秒：站立。9-10.5秒穿@图片1的衣服。');
  assert.ok(bad.some(issue => /整数秒/.test(issue)));
  assert.ok(bad.some(issue => /相接/.test(issue)));
  assert.deepEqual(run('@图片1是第1套衣服（0-5.5秒穿）：只采用衣服。0-15秒穿@图片1的衣服。'), []);
});
