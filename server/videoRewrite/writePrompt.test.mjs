import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePrompt } from './writePrompt.mjs';
import { checkRules, EDIT_WORDS } from './rules.mjs';
import { planFromReply } from './analyze.mjs';

// 10-30 真豆包窄拆解（吊扇，草稿区 s2-fan-2）转成的改写单；连线顺序同页面：背景、要换项、深度、原声。
const plan = planFromReply({
  people: [{ id: 'P1', desc: '年轻女性，棕色长卷发', from: 0, to: 15.047 }],
  clothes: [{ id: 'C1', desc: '短款立领连衣裙，深蓝色丝绒材质', from: 0, to: 5.8 }, { id: 'C2', desc: '吊带超短连衣裙，上粉下橙渐变亮片', from: 5.8, to: 9.2 },
    { id: 'C3', desc: '露肩吊带长裙，米白色缎面', from: 9.2, to: 12.6 }, { id: 'C4', desc: '方领短袖鱼尾长裙，深藏蓝色丝绒', from: 12.6, to: 15.047 }],
  things: [{ id: 'D1', desc: '遥控器，黑色长条形，表面有多颗按键' }, { id: 'D2', desc: '吊扇叶片，深棕色木质，带有银灰色金属固定件' }],
  replace: ['P1', 'C1', 'C2', 'C3', 'C4'], unsure: []
}, 15.047);
const materials = [{ tag: '@图片1', purpose: '背景' },
  ...plan.replace.map((itemId, index) => ({ tag: `@图片${index + 2}`, itemId, purpose: itemId, originalDesc: plan.items.find(item => item.id === itemId).desc })),
  { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }, { tag: '@音频1', purpose: '原声，作为背景音乐和节奏参考' }];
const input = { cardId: 'card-1', plan, materials, duration: 15, sourceDuration: 15.047, ratio: '9:16', userText: '将视频中的人物还有每套衣服都换成我的' };
const clothesRole = '只采用衣服的款式、长短、颜色和材质，不采用图中的人台、模特和背景。';

test('10-30 提示词由代码按模板拼：素材职责、换装时间轴、结尾（不写「画面里还有」）；同样输入每次一字不差，免费检查零问题', () => {
  const result = writePrompt(input);
  assert.equal(result.videoPrompt, [
    '@图片1是场景：只采用场景的布局、陈设、颜色和光线，不采用图中人物。',
    '@图片2是人物：只采用脸、发型和身材，不采用图中的衣服和背景。',
    `@图片3是第1套衣服（0-5.8秒穿）：${clothesRole}`, `@图片4是第2套衣服（5.8-9.2秒穿）：${clothesRole}`,
    `@图片5是第3套衣服（9.2-12.6秒穿）：${clothesRole}`, `@图片6是第4套衣服（12.6-15秒穿）：${clothesRole}`,
    '@视频1只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机，不采用其中的灰度画面、发型和衣服轮廓；@视频1里的人就是@图片2。',
    '@音频1是背景音乐，动作和换装节奏跟随它。',
    '0-5秒：人物身穿@图片3的衣服。', '5-6秒：人物身穿@图片3的衣服，随后身穿@图片4的衣服，换装时机跟随@视频1。',
    '6-9秒：人物身穿@图片4的衣服。', '9-10秒：人物身穿@图片4的衣服，随后身穿@图片5的衣服，换装时机跟随@视频1。',
    '10-12秒：人物身穿@图片5的衣服。', '12-13秒：人物身穿@图片5的衣服，随后身穿@图片6的衣服，换装时机跟随@视频1。',
    '13-15秒：人物身穿@图片6的衣服。', '全程同一个人、同一个场景和光线，不要字幕。'].join('\n'));
  assert.equal(writePrompt(input).videoPrompt, result.videoPrompt);
  assert.deepEqual(checkRules({ ...input, ...result }), []);
});

test('不写豆包看不准的：机位、扫过、动作、东西几秒动；不出现编辑触发词和要换项的原描述', () => {
  const { videoPrompt } = writePrompt(input);
  for (const word of ['固定机位', '俯拍', '扫过', '躺', '转动', ...EDIT_WORDS]) assert.ok(!videoPrompt.includes(word), word);
  for (const id of plan.replace) assert.ok(!videoPrompt.includes(plan.items.find(item => item.id === id).desc), id);
});

test('只有一套衣服：声音那句不提换装，时间轴一段到底；没有别的东西就不写「画面里还有」', () => {
  const one = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 15 }], clothes: [{ id: 'C1', desc: '套装，黑红', from: 0, to: 15 }],
    things: [], replace: ['P1', 'C1'], unsure: [] }, 15);
  const result = writePrompt({ ...input, plan: one, sourceDuration: 15, materials: [materials[0], materials[1], { ...materials[2], itemId: 'C1' }, ...materials.slice(-2)] });
  assert.match(result.videoPrompt, /@音频1是背景音乐，动作节奏跟随它。/);
  assert.match(result.videoPrompt, /\n0-15秒：人物身穿@图片3的衣服。\n全程同一个人/);
  assert.ok(!result.videoPrompt.includes('画面里还有'));
  assert.deepEqual(checkRules({ ...input, plan: one, ...result, materials: [materials[0], materials[1], { ...materials[2], itemId: 'C1' }, ...materials.slice(-2)] }), []);
});

test('画面里还有的东西不写进提示词（10-30 两条真成片都被这句带偏），只在提醒里列没换的道具 / 遮挡物 / 其他的名字', () => {
  const old = { ...plan, items: [...plan.items, { id: 'S1', kind: '场景', desc: '客厅，米色沙发', from: 0, to: 15, frame: 0 },
    { id: 'O1', kind: '遮挡物', desc: '木板', from: 0, to: 15, frame: 0 }, { id: 'X1', kind: '其他', desc: '气球，红色', from: 0, to: 15, frame: 0 }],
    replace: [...plan.replace, 'D1'], actions: [{ from: 0, to: 15, desc: '躺着' }], summary: '旧单子' };
  const result = writePrompt({ ...input, plan: old, materials: [...materials.slice(0, 6), { tag: '@图片7', itemId: 'D1', purpose: '道具' }, ...materials.slice(-2)] });
  for (const word of ['画面里还有', '吊扇叶片', '木板', '气球']) assert.ok(!result.videoPrompt.includes(word), word);
  assert.deepEqual(result.warnings, ['拆解认出画面里还有吊扇叶片、木板、气球：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。']);
  assert.match(result.videoPrompt, /@图片7是道具：只采用它的外形、颜色和材质/);
});

test('衣服没换就照拆解描述写穿着；要换却没连图就写「第N套衣服」，不带回原描述', () => {
  const keep = writePrompt({ ...input, plan: { ...plan, replace: ['P1'] }, materials: [materials[0], materials[1], ...materials.slice(-2)] });
  assert.match(keep.videoPrompt, /0-5秒：人物身穿短款立领连衣裙，深蓝色丝绒材质。/);
  const missing = writePrompt({ ...input, materials: materials.filter(row => row.tag !== '@图片3') });
  assert.match(missing.videoPrompt, /0-5秒：人物身穿第1套衣服。/);
  assert.ok(!missing.videoPrompt.includes(plan.items[1].desc));
});

test('没连深度视频就不写「跟随@视频」；生成时长改短，超出的换装点不写、时间轴到新时长', () => {
  const noDepth = writePrompt({ ...input, materials: materials.filter(row => !row.tag.startsWith('@视频')) });
  assert.ok(!noDepth.videoPrompt.includes('@视频'));
  assert.match(noDepth.videoPrompt, /5-6秒：人物身穿@图片3的衣服，随后身穿@图片4的衣服。/);
  const short = writePrompt({ ...input, duration: 10 });
  assert.match(short.videoPrompt, /\n9-10秒：人物身穿@图片4的衣服，随后身穿@图片5的衣服，换装时机跟随@视频1。\n全程/);
  assert.ok(!short.videoPrompt.includes('12-13秒'));
  assert.deepEqual(checkRules({ ...input, duration: 10, ...short }), []);
});

test('旧单子 changes 在衣服交界附近：换装段按 changes 秒数（10-29 衣服2写 6 秒开始、换装 5.8）', () => {
  const late = { ...plan, items: plan.items.map(item => item.id === 'C2' ? { ...item, from: 6, frame: 6 } : item), changes: [{ second: 5.8, how: '换装' }] };
  assert.match(writePrompt({ ...input, plan: late }).videoPrompt, /\n5-6秒：人物身穿@图片3的衣服，随后身穿@图片4的衣服/);
});

test('同一秒里换两次装：并成一段写到最后一套，时间轴不重叠', () => {
  const quick = planFromReply({ people: [{ id: 'P1', desc: '女生', from: 0, to: 15 }], things: [], unsure: [], replace: ['P1', 'C1', 'C2', 'C3'],
    clothes: [{ id: 'C1', desc: '裙子，红', from: 0, to: 5.2 }, { id: 'C2', desc: '裙子，蓝', from: 5.2, to: 5.8 }, { id: 'C3', desc: '裙子，白', from: 5.8, to: 15 }] }, 15);
  const rows = [materials[0], materials[1], { tag: '@图片3', itemId: 'C1', purpose: '衣服' }, { tag: '@图片4', itemId: 'C2', purpose: '衣服' },
    { tag: '@图片5', itemId: 'C3', purpose: '衣服' }, ...materials.slice(-2)];
  const result = writePrompt({ ...input, plan: quick, sourceDuration: 15, materials: rows });
  assert.match(result.videoPrompt, /\n0-5秒：人物身穿@图片3的衣服。\n5-6秒：人物身穿@图片3的衣服，随后身穿@图片5的衣服，换装时机跟随@视频1。\n6-15秒：人物身穿@图片5的衣服。\n/);
  assert.deepEqual(checkRules({ ...input, plan: quick, materials: rows, ...result }), []);
});

test('提醒：拆解没把握的照列；画面里有东西时列出名字；都没有就空', () => {
  assert.deepEqual(writePrompt({ ...input, plan: { ...plan, unsure: ['柜子上那团灰的看不清'] } }).warnings,
    ['拆解没把握：柜子上那团灰的看不清', '拆解认出画面里还有遥控器、吊扇叶片：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。']);
  const bare = { ...plan, items: plan.items.filter(item => item.kind !== '道具') };
  assert.deepEqual(writePrompt({ ...input, plan: bare }).warnings, []);
});

test('坏改写单直接报错，不出提示词', () => {
  assert.throws(() => writePrompt({ ...input, plan: { ...plan, items: [] } }), /改写单/);
});
