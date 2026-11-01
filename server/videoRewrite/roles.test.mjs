import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePrompt } from './writePrompt.mjs';
import { checkRules } from './rules.mjs';
import { checkMaterials } from './input.mjs';

// 10-25 真跑原文；仅作回归样例，不读取外部文件。
const real = {
  "note": "10-25 用户真跑：第三轮豆包写的视频提示词、各图片卡快照和出图词；连线顺序 @图片1=背景、@图片2=人物、@图片3~6=衣服1~4、@视频1=深度、@音频1=原声",
  "videoPrompt": "俯拍视角下，一名女子从侧边沙发移动到浅灰花纹地毯上躺卧，期间多次更换不同款式的服装，全程保持躺卧姿态并配合调整动作，总时长15秒。\n0-1秒：@视频1参考机位、动作、空间和遮挡节奏，里面的人就是@图片2，颜色材质不参考，全程彩色；@图片1是场景，房间布置、颜色材质和光线照它；女子从沙发上翻滚移动到地毯上，调整躺卧姿态，头发散开，身穿@图片3（蓝黑底色带有复古花卉纹样的短款连衣裙，肩部有飞翼装饰，立领露胸设计），画面上方棕色木质结构带金属配件作为遮挡物在画面顶部，黑色遥控器放置在沙发旁地面；@音频1是背景音乐，动作和换装节奏跟随它；不要字幕。\n1-4秒：女子躺于地面，一只手抬起做出动作，另一只手靠近遥控器，身穿@图片3（蓝黑底色带有复古花卉纹样的短款连衣裙，肩部有飞翼装饰，立领露胸设计），其余画面元素保持一致。\n4-5秒：女子抬手调整姿态，身穿@图片3（蓝黑底色带有复古花卉纹样的短款连衣裙，肩部有飞翼装饰，立领露胸设计），其余画面元素保持一致。\n5-6秒：画面上方棕色木质结构带金属配件从顶部扫过，挡住人的瞬间，人物服装更换为@图片4（粉橙渐变短款吊带裙，裙身有花卉图案装饰，下摆有开叉），女子继续调整姿态，其余画面元素保持一致。\n6-8秒：女子躺于地面调整姿态，身穿@图片4（粉橙渐变短款吊带裙，裙身有花卉图案装饰，下摆有开叉），其余画面元素保持一致。\n8-9秒：画面上方棕色木质结构带金属配件从顶部扫过，挡住人的瞬间，人物服装更换为@图片5（米白色露肩短款礼服，上身有暗纹，腰部有荷叶边设计，带有拖尾褶皱裙摆），女子继续调整姿态，其余画面元素保持一致。\n9-12秒：女子躺于地面调整手臂、腿部姿态展示服装，身穿@图片5（米白色露肩短款礼服，上身有暗纹，腰部有荷叶边设计，带有拖尾褶皱裙摆），其余画面元素保持一致。\n12-13秒：画面上方棕色木质结构带金属配件从顶部扫过，挡住人的瞬间，人物服装更换为@图片6（藏蓝色带白色星点图案的长款鱼尾礼服，方领设计，裙摆宽大），女子继续调整姿态，其余画面元素保持一致。\n13-15秒：女子躺于地面调整手臂、腿部姿态展示服装，身穿@图片6（藏蓝色带白色星点图案的长款鱼尾礼服，方领设计，裙摆宽大），其余画面元素保持一致。\n贯穿全片：机位为俯拍，全程保持固定俯拍视角；场景为@图片1的室内场景，地面铺浅灰混色花纹地毯，旁侧有米色沙发，黑色遥控器放置在沙发旁地面，画面上方有棕色木质结构带金属配件部分遮挡顶部；光线为自然阳光照射，形成柔和光影；声音全程使用@音频1作为背景音乐，动作和换装节奏跟随音频节奏，不要字幕。",
  "changeSeconds": [
    5.5,
    8.5,
    12
  ],
  "duration": 15,
  "ratio": "9:16",
  "items": [
    {
      "title": "人物",
      "item": {
        "id": "P1",
        "kind": "人物",
        "desc": "视频中的年轻女性，从沙发移动到地面躺卧，做出调整姿态、抬手等动作",
        "from": 0,
        "to": 15.047,
        "frame": 2
      },
      "imagePrompt": "人物单人、干净背景"
    },
    {
      "title": "衣服 1（0-5.5 秒）",
      "item": {
        "id": "C1",
        "kind": "衣服",
        "desc": "蓝黑底色带有复古花卉纹样的短款连衣裙，肩部有飞翼装饰，立领露胸设计",
        "from": 0,
        "to": 5.5,
        "frame": 2
      },
      "imagePrompt": "衣服用平铺或无头人台、纯色背景、不出现人脸，展示蓝黑底色带有复古花卉纹样的短款连衣裙，肩部有飞翼装饰，立领露胸设计"
    },
    {
      "title": "衣服 2（5.5-8.5 秒）",
      "item": {
        "id": "C2",
        "kind": "衣服",
        "desc": "粉橙渐变短款吊带裙，裙身有花卉图案装饰，下摆有开叉",
        "from": 5.5,
        "to": 8.5,
        "frame": 6
      },
      "imagePrompt": "衣服用平铺或无头人台、纯色背景、不出现人脸，展示粉橙渐变短款吊带裙，裙身有花卉图案装饰，下摆有开叉"
    },
    {
      "title": "衣服 3（8.5-12 秒）",
      "item": {
        "id": "C3",
        "kind": "衣服",
        "desc": "米白色露肩短款礼服，上身有暗纹，腰部有荷叶边设计，带有拖尾褶皱裙摆",
        "from": 8.5,
        "to": 12,
        "frame": 9.5
      },
      "imagePrompt": "衣服用平铺或无头人台、纯色背景、不出现人脸，展示米白色露肩短款礼服，上身有暗纹，腰部有荷叶边设计，带有拖尾褶皱裙摆"
    },
    {
      "title": "衣服 4（12-15 秒）",
      "item": {
        "id": "C4",
        "kind": "衣服",
        "desc": "藏蓝色带白色星点图案的长款鱼尾礼服，方领设计，裙摆宽大",
        "from": 12,
        "to": 15.047,
        "frame": 13
      },
      "imagePrompt": "衣服用平铺或无头人台、纯色背景、不出现人脸，展示藏蓝色带白色星点图案的长款鱼尾礼服，方领设计，裙摆宽大"
    }
  ]
};
const items = real.items.map(row => ({ ...row.item, to: Math.min(row.item.to, real.duration) }));
const plan = { summary: '女子换装', items, replace: items.map(item => item.id),
  changes: real.changeSeconds.map(second => ({ second, how: '遮挡时换装' })),
  actions: [{ from: 0, to: 15, desc: '跟随参考动作' }], lookAgain: [2, 6], unsure: [] };
const materials = [{ tag: '@图片1', purpose: '背景' },
  ...items.map((item, index) => ({ tag: `@图片${index + 2}`, itemId: item.id, purpose: item.kind, originalDesc: item.desc })),
  { tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' }];
const input = { plan, materials, duration: 15, ratio: '9:16', userText: '人物和衣服换成我的' };
const write = (patch = {}) => writePrompt({ ...input, ...patch });
const rolesPart = text => text.split(/\n0-\d+秒：/)[0];

test('真素材顺序：代码在时间轴前拼每份职责，采用和不采用清楚且不含原描述', () => {
  const result = write();
  assert.ok(result.videoPrompt.startsWith('@图片1是场景：只采用场景的布局、陈设、颜色和光线'));
  const prefix = rolesPart(result.videoPrompt);
  for (const material of materials) assert.ok(prefix.includes(material.tag), material.tag);
  assert.match(prefix, /@图片2是人物：只采用脸、发型和身材，不采用图中的衣服和背景/);
  for (const [index, span] of ['0-5.5', '5.5-8.5', '8.5-12', '12-15'].entries()) {
    assert.ok(prefix.includes(`@图片${index + 3}是第${index + 1}套衣服（${span}秒穿）`));
  }
  assert.equal((prefix.match(/不采用图中的人台、模特和背景/g) ?? []).length, 4);
  assert.match(prefix, /不采用图中人物/);
  assert.match(prefix, /@视频1只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机，不采用其中的灰度画面、发型和衣服轮廓/);
  assert.match(prefix, /@视频1里的人就是@图片2/);
  assert.match(prefix, /@音频1是背景音乐，动作和换装节奏跟随它/);
  for (const item of items) assert.ok(!prefix.includes(item.desc));
  assert.deepEqual(checkRules({ ...input, ...result }), []);
});

test('未连入素材不写职责；多人称呼不同，深度指认对应人物；未换人物不指认', () => {
  const second = { ...items[0], id: 'P2' };
  const changedPlan = { ...plan, items: [...items, second], replace: [...plan.replace, second.id] };
  const added = { tag: '@图片7', itemId: 'P2', purpose: '人物' };
  const result = write({ plan: changedPlan, materials: [...materials, added] });
  assert.match(result.videoPrompt, /@图片2是人物1/);
  assert.match(result.videoPrompt, /@图片7是人物2/);
  assert.match(result.videoPrompt, /@视频1里的人物1就是@图片2，人物2就是@图片7/);
  const without = write({ materials: materials.filter(row => !['@图片2', '@音频1'].includes(row.tag)) });
  assert.ok(!without.videoPrompt.includes('里的人就是'));
  assert.ok(!without.videoPrompt.includes('@音频1'));
});

test('要换道具、遮挡物、其他和场景均有职责且无原描述', () => {
  for (const kind of ['道具', '遮挡物', '其他', '场景']) {
    const selected = { ...items[0], kind, id: 'X1', desc: '原视频红色金属物品' };
    const result = write({ plan: { ...plan, items: [selected], replace: ['X1'] },
      materials: [{ tag: '@图片1', purpose: kind, itemId: 'X1' }] });
    assert.match(result.videoPrompt, kind === '场景' ? /只采用场景的布局/ : /只采用它的外形、颜色和材质，不采用图中背景/);
    assert.ok(!result.videoPrompt.includes(selected.desc));
  }
});

test('真原文同时报原描述泄漏、职责晚于时间轴；逗号顿号分号片段同样拦', () => {
  const issues = checkRules({ ...input, videoPrompt: real.videoPrompt });
  assert.ok(issues.some(issue => /原描述/.test(issue)));
  assert.ok(issues.some(issue => /时间轴前/.test(issue)));
  for (const separator of ['，', ',', '、', '；', ';']) {
    const originalDesc = ['原来的藏蓝色长裙', '袖口带着白色花边', '下摆带有层叠褶皱'].join(separator);
    const result = write();
    for (const fragment of [originalDesc, ...originalDesc.split(separator)]) {
      assert.ok(checkRules({ ...input, materials: [{ tag: '@图片3', purpose: '衣服', originalDesc }],
        videoPrompt: result.videoPrompt + fragment }).some(issue => /原描述/.test(issue)), fragment);
    }
  }
});

test('新结构零问题；用户另写红色短裙不误拦；旧存档没有原描述不报错', () => {
  const result = write();
  assert.deepEqual(checkRules({ ...input, ...result }), []);
  assert.deepEqual(checkRules({ ...input, videoPrompt: result.videoPrompt.replace('身穿@图片3的衣服', '身穿@图片3（红色短裙）') }), []);
  const oldMaterials = materials.map(({ originalDesc, ...rest }) => rest);
  assert.deepEqual(checkRules({ ...input, materials: oldMaterials, ...result, plan: undefined }), []);
  assert.deepEqual(checkMaterials(oldMaterials), oldMaterials);
  assert.deepEqual(checkMaterials(materials), materials);
});

test('职责位置按完整编号区分：@图片10不能代替@图片1', () => {
  const result = checkRules({ duration: 15, materials: [{ tag: '@图片1', purpose: '人物' }, { tag: '@图片10', purpose: '道具' }],
    videoPrompt: '@图片10是道具。\n0-15秒：@图片1站立。' });
  assert.ok(result.some(issue => issue.includes('@图片1') && /时间轴前/.test(issue)));
});

test('第三轮对全部要换项查原描述，未连入素材也不能带回原样子', () => {
  const issues = checkRules({ ...input, materials: [], videoPrompt: `0-15秒：身穿${items[1].desc}。` });
  assert.ok(issues.some(issue => /原描述/.test(issue) && issue.includes('C1')));
});
