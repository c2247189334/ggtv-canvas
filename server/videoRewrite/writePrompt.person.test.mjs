import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePrompt } from './writePrompt.mjs';
import { checkRules } from './rules.mjs';
import { planFromReply } from './analyze.mjs';

// 10-30 功夫舞真改写卡（card-3886706a）存下的拆解单：一人一套衣服两只猫，只换人。
const plan = {
  summary: '拆解：1个人，1套衣服，画面里还有宠物长毛猫、宠物短毛猫',
  items: [
    { id: 'P1', kind: '人物', desc: '年轻女生，黑色齐刘海，头发编成两条系红色发带的长辫，佩戴小巧耳饰', from: 0, to: 6.6, frame: 0 },
    { id: 'C1', kind: '衣服', desc: '中式舞蹈套装，黑底红色花枝纹样立领短袖收腰上衣，正红色带浅金色花卉暗纹的轻薄宽松束脚灯笼长裤，赤脚，裤脚带有红色细系带', from: 0, to: 6.6, frame: 0 },
    { id: 'D1', kind: '道具', desc: '宠物长毛猫，毛发白棕灰相间，爪子为白色，背部和尾部毛色偏深', from: 0, to: 6.66, frame: 0 },
    { id: 'D2', kind: '道具', desc: '宠物短毛猫，毛发银灰色带黑色虎斑条纹', from: 0, to: 6.66, frame: 0 }],
  changes: [], actions: [], replace: ['P1'], unsure: []
};
const materials = [{ tag: '@图片1', purpose: '背景' }, { tag: '@图片2', purpose: '人物', itemId: 'P1', originalDesc: plan.items[0].desc },
  { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }];
const input = { cardId: 'card-3886706a', plan, materials, duration: 7, sourceDuration: 6.66, ratio: '9:16', userText: '人物换掉' };
// 用户连的人物图：环卫工三视图（作品 a6ad1702），看图回答的样子。
const worker = { '@图片2': { views: 3, plainClothes: false, clothes: '橙色长袖工作服和橙色长裤，带银灰色反光条，黑色工作鞋', hair: '灰白色短发' } };
const scene = '@图片1是场景：只采用场景的布局、陈设、颜色和光线，不采用图中人物。';
const depth = '@视频1只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机，不采用其中的灰度画面、发型和衣服轮廓；@视频1里的人就是@图片2。';
const end = '全程同一个人、同一个场景和光线，不要字幕。';

test('10-30 功夫舞：只换人、人物图穿着自己的衣服 → 衣服发型都照人物图，深度不采用发型，不写原衣服，不写「画面里还有」', () => {
  const result = writePrompt(input, worker);
  assert.equal(result.videoPrompt, [scene,
    '@图片2是人物：采用脸、发型（灰白色短发）、身材和衣服，不采用图中的背景；图里3个身影是同一个人的不同角度，画面里只出现这一个人。',
    depth, '0-7秒：人物身穿@图片2里的衣服（橙色长袖工作服和橙色长裤，带银灰色反光条，黑色工作鞋）。', end].join('\n'));
  assert.ok(!result.videoPrompt.includes('舞蹈') && !result.videoPrompt.includes('猫'));
  assert.deepEqual(result.warnings, ['拆解认出画面里还有宠物长毛猫、宠物短毛猫：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。']);
  assert.deepEqual(checkRules({ ...input, ...result }), []);
});

test('原话说了衣服不换 / 只换脸，才照原视频写衣服；人物图只取脸、发型和身材', () => {
  for (const userText of ['人物换掉，衣服不换', '只换脸', '换脸', '保留原来的衣服', '衣服保持原样']) {
    const result = writePrompt({ ...input, userText }, worker);
    assert.match(result.videoPrompt, /\n@图片2是人物：只采用脸、发型（灰白色短发）和身材，不采用图中的衣服和背景；图里3个身影是同一个人的不同角度，画面里只出现这一个人。\n/, userText);
    assert.match(result.videoPrompt, /\n0-7秒：人物身穿中式舞蹈套装，黑底红色花枝纹样立领短袖收腰上衣，/, userText);
    assert.ok(result.videoPrompt.includes(depth), '换了人就不跟深度里的发型');
    assert.deepEqual(checkRules({ ...input, userText, ...result }), [], userText);
  }
  assert.match(writePrompt({ ...input, userText: '人物和衣服都换掉' }, worker).videoPrompt, /0-7秒：人物身穿@图片2里的衣服/);
});

test('人物图只穿纯色打底衣服（出图模板那种占位）→ 照原视频写衣服', () => {
  const plain = { '@图片2': { views: 1, plainClothes: true, clothes: '白色纯色T恤和灰色打底裤', hair: '黑色短发' } };
  const result = writePrompt(input, plain);
  assert.match(result.videoPrompt, /\n@图片2是人物：只采用脸、发型（黑色短发）和身材，不采用图中的衣服和背景。\n/);
  assert.match(result.videoPrompt, /\n0-7秒：人物身穿中式舞蹈套装，/);
  assert.ok(!result.videoPrompt.includes('白色纯色T恤'));
  assert.deepEqual(checkRules({ ...input, ...result }), []);
});

test('没有看图结果时默认也用人物图的衣服，只是不带描述', () => {
  const result = writePrompt(input);
  assert.match(result.videoPrompt, /\n@图片2是人物：采用脸、发型、身材和衣服，不采用图中的背景。\n/);
  assert.match(result.videoPrompt, /\n0-7秒：人物身穿@图片2里的衣服。\n/);
  assert.deepEqual(checkRules({ ...input, ...result }), []);
});

test('原视频在换装（多套衣服）又只换人：保留换装照原视频写，提醒人物图的衣服没用上', () => {
  const fan = planFromReply({
    people: [{ id: 'P1', desc: '年轻女性，棕色长卷发', from: 0, to: 15.047 }],
    clothes: [{ id: 'C1', desc: '短款立领连衣裙，深蓝色丝绒材质', from: 0, to: 5.8 }, { id: 'C2', desc: '吊带超短连衣裙，上粉下橙渐变亮片', from: 5.8, to: 15.047 }],
    things: [], replace: ['P1'], unsure: []
  }, 15.047);
  const rows = [materials[0], { ...materials[1], originalDesc: fan.items[0].desc }, materials[2]];
  const result = writePrompt({ ...input, plan: fan, materials: rows, duration: 15, sourceDuration: 15.047 }, worker);
  assert.match(result.videoPrompt, /\n0-5秒：人物身穿短款立领连衣裙，深蓝色丝绒材质。\n5-6秒：人物身穿短款立领连衣裙，深蓝色丝绒材质，随后身穿吊带超短连衣裙/);
  assert.match(result.videoPrompt, /@图片2是人物：只采用脸、发型（灰白色短发）和身材，不采用图中的衣服和背景/);
  assert.deepEqual(result.warnings, ['原视频有2套衣服在换装，提示词照原视频写了换装；人物图里自己穿的衣服没用上。']);
  assert.deepEqual(checkRules({ ...input, plan: fan, materials: rows, duration: 15, sourceDuration: 15.047, ...result }), []);
});

test('看图结果：只有一个身影就不写角度那句；没认出发型就不加括号', () => {
  const result = writePrompt(input, { '@图片2': { views: 1, plainClothes: false, clothes: '深蓝色西装和白衬衫', hair: '' } });
  assert.match(result.videoPrompt, /\n@图片2是人物：采用脸、发型、身材和衣服，不采用图中的背景。\n/);
  assert.match(result.videoPrompt, /\n0-7秒：人物身穿@图片2里的衣服（深蓝色西装和白衬衫）。\n/);
});

test('没连人物图：深度视频照旧只不采用衣服轮廓，不加发型', () => {
  const clothesOnly = { ...plan, replace: ['C1'] };
  const rows = [materials[0], { tag: '@图片2', purpose: '衣服', itemId: 'C1', originalDesc: plan.items[1].desc }, materials[2]];
  const result = writePrompt({ ...input, plan: clothesOnly, materials: rows }, {});
  assert.match(result.videoPrompt, /\n@视频1只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机，不采用其中的灰度画面和衣服轮廓。\n/);
  assert.match(result.videoPrompt, /\n0-7秒：人物身穿@图片2的衣服。\n/);
});
