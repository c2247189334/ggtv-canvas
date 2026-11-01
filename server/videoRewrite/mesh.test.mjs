import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as roles from './roles.mjs';
import { writePrompt } from './writePrompt.mjs';
import { checkRules } from './rules.mjs';

const purpose = '白模，参考人物动作、姿态、位置和机位';
const person = { id: 'P1', kind: '人物', desc: '原人物', from: 0, to: 6, frame: 0 };
const plan = { summary: '动作', items: [person], replace: ['P1'], actions: [], changes: [], unsure: [], lookAgain: [] };
const video = { tag: '@视频12', purpose };
const picture = { tag: '@图片8', purpose: '人物', itemId: 'P1' };
const expected = '@视频12是白模参考：只采用人物的动作、姿态、位置和机位，不采用其中的灰色模型外观、材质和黑色背景；@视频12里的灰色人体模型就是@图片8。';

test('白模用途常量逐字固定，单人职责逐字相同，不受背景是否换场景影响', () => {
  assert.equal(roles.MESH_PURPOSE, purpose);
  for (const background of ['背景', roles.NEW_SCENE_PURPOSE]) {
    const text = roles.materialRoles({ plan, materials: [{ tag: '@图片1', purpose: background }, video, picture] });
    assert.ok(text.split('\n').includes(expected)); assert.ok(!text.includes('灰度画面'));
  }
});

test('白模没有换人物不指认；多人沿用人物顺序称呼并改为灰色人体模型', () => {
  assert.equal(roles.materialRoles({ plan: { ...plan, replace: [] }, materials: [video] }), expected.split('；')[0] + '。');
  const second = { ...person, id: 'P2' };
  const text = roles.materialRoles({ plan: { ...plan, items: [person, second], replace: ['P1', 'P2'] },
    materials: [video, picture, { tag: '@图片9', itemId: 'P2', purpose: '人物' }] });
  assert.ok(text.includes('；@视频12里的灰色人体模型1就是@图片8，灰色人体模型2就是@图片9。'));
});

test('白模规则要求同一句写机位动作，深度原检查保持严格', () => {
  const materials = [video, picture], text = `${expected}\n@图片8是人物。\n0-6秒：人物站立。`;
  assert.deepEqual(checkRules({ videoPrompt: text, materials, duration: 6 }), []);
  for (const word of ['机位', '动作']) {
    const issues = checkRules({ videoPrompt: text.replaceAll(word, ''), materials, duration: 6 });
    assert.ok(issues.some(issue => issue.includes('@视频12') && /白模.*机位.*动作/.test(issue)));
  }
  const depth = [{ ...video, purpose: '深度，参考机位、动作、空间和遮挡节奏' }, picture];
  assert.ok(checkRules({ videoPrompt: text.replaceAll('机位', ''), materials: depth, duration: 6 }).some(issue => /深度视频.*机位.*动作/.test(issue)));
});

test('白模道具和遮挡物名字用顿号列入提醒（包含要替换的物品），不拦发送；深度没有这条', () => {
  const props = [{ id: 'D1', kind: '道具', desc: '球杆，银色', from: 0, to: 6, frame: 0 },
    { id: 'O1', kind: '遮挡物', desc: '扇叶，木质', from: 0, to: 6, frame: 0 }];
  const input = { plan: { ...plan, items: [...plan.items, ...props], replace: ['P1', 'D1'] }, materials: [video, picture],
    duration: 6, sourceDuration: 6, ratio: '16:9', userText: '人物换成我的' };
  const result = writePrompt(input);
  assert.ok(result.warnings.includes('白模里没有球杆、扇叶，成片里它怎么动只能靠模型猜；在意就改用深度'));
  assert.ok(!result.warnings.some(warning => warning.includes('交给背景图和深度视频')));
  assert.ok(result.videoPrompt.includes(expected)); assert.deepEqual(checkRules({ ...input, ...result }), []);
  const depth = writePrompt({ ...input, materials: [{ ...video, purpose: '深度' }, picture] });
  assert.ok(!depth.warnings.some(warning => warning.startsWith('白模里没有')));
});
