import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writePrompt, sceneRatioNotes } from './writePrompt.mjs';
import { NEW_SCENE_PURPOSE } from './roles.mjs';
import { checkRules } from './rules.mjs';
import { planFromReply } from './analyze.mjs';
import { createPromptImages } from './promptImages.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { solidPng } from '../png.mjs';
import { tempDir } from '../testKit.mjs';
import { setup } from './routeTestKit.mjs';

// 10-30 用户定：「背景和原片一致」不勾时背景卡换成新场景，深度视频不能再把原片的场景和东西带回来。
const plan = planFromReply({
  people: [{ id: 'P1', desc: '年轻女性，棕色长卷发', from: 0, to: 10 }],
  clothes: [{ id: 'C1', desc: '深蓝色连衣裙', from: 0, to: 10 }],
  things: [{ id: 'D1', desc: '遥控器，黑色长条形' }],
  replace: ['P1', 'C1'], unsure: []
}, 10);
const materials = purpose => [{ tag: '@图片1', purpose }, { tag: '@图片2', itemId: 'P1', purpose: '人物' },
  { tag: '@图片3', itemId: 'C1', purpose: '衣服 1（0-10 秒穿）' }, { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }];
const input = purpose => ({ cardId: 'card-1', plan, materials: materials(purpose), duration: 10, sourceDuration: 10, ratio: '9:16', userText: '人和衣服换成我的，背景换成海边' });

test('新场景：深度只采用人物动作和机位、不采用场景和东西；背景照样写成场景；免费检查零问题', () => {
  assert.ok(NEW_SCENE_PURPOSE.startsWith('背景'), '用途以「背景」开头，免费检查照样要求同一句写场景');
  const result = writePrompt(input(NEW_SCENE_PURPOSE));
  const lines = result.videoPrompt.split('\n');
  assert.equal(lines[0], '@图片1是场景：只采用场景的布局、陈设、颜色和光线，不采用图中人物。');
  assert.equal(lines[3], '@视频1只采用人物的动作、姿态、位置和机位，不采用其中的场景、东西、灰度画面、发型和衣服轮廓；@视频1里的人就是@图片2。');
  assert.deepEqual(checkRules({ ...input(NEW_SCENE_PURPOSE), ...result }), []);
  const kept = writePrompt(input('背景'));
  assert.match(kept.videoPrompt, /@视频1只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机/);
});

test('新场景：原片里的东西提醒改成「可能没有、要留自己补」', () => {
  assert.deepEqual(writePrompt(input(NEW_SCENE_PURPOSE)).warnings, ['拆解认出原片里还有遥控器：换了新背景、提示词也没写，成片里可能没有；要留哪样，自己在提示词里补一句。']);
  assert.deepEqual(writePrompt(input('背景')).warnings, ['拆解认出画面里还有遥控器：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。']);
});

test('背景图比例和视频差一成以上才提醒，读不出尺寸不提醒', () => {
  assert.deepEqual(sceneRatioNotes('9:16', { width: 1024, height: 768 }),
    ['背景图是 1024×768，和视频 9:16 的比例差得多，成片里背景可能被裁掉一块或补出来；建议换一张比例相近的图，或在背景卡里重新生成。']);
  assert.deepEqual(sceneRatioNotes('16:9', { width: 64, height: 32 }).length, 1);
  for (const [ratio, size] of [['9:16', { width: 720, height: 1280 }], ['16:9', { width: 864, height: 480 }], ['9:16', null]]) {
    assert.deepEqual(sceneRatioNotes(ratio, size), [], `${ratio} ${JSON.stringify(size)}`);
  }
});

test('读素材图宽高：上传图和作品图都认，读不到或不是图给 null，不启动外部程序', () => {
  const root = tempDir(), uploads = createUploadStore(root), works = createWorkStore(root);
  const png = solidPng(64, 32, [100, 120, 140]);
  const images = createPromptImages({ uploads, works, executor: { run: async () => { throw Error('不该启动'); }, stop: () => {} } });
  assert.deepEqual(images.sizeOf({ type: 'upload', id: uploads.save(png).id }), { width: 64, height: 32 });
  assert.deepEqual(images.sizeOf({ type: 'work', id: works.add(png, {}).id }), { width: 64, height: 32 });
  assert.equal(images.sizeOf({ type: 'upload', id: 'missing' }), null);
  assert.equal(images.sizeOf(undefined), null);
});

test('生成提示词：背景图比例对不上就在提醒里写，对得上不写；只提醒、不进问题、照样免费', async () => {
  const s = setup();
  const background = (width, height) => ({ type: 'upload', id: s.app.stores.uploads.save(solidPng(width, height, [90, 120, 150])).id });
  const body = asset => ({ ...input(NEW_SCENE_PURPOSE), plan: { ...plan, replace: ['C1'] },
    materials: [{ tag: '@图片1', purpose: NEW_SCENE_PURPOSE, asset }, { tag: '@图片2', itemId: 'C1', purpose: '衣服 1（0-10 秒穿）', asset: background(40, 40) },
      { tag: '@视频1', purpose: '深度，参考机位、动作、空间和遮挡节奏' }] });
  const wrong = await s.call('POST', '/api/video-rewrite/prompt', body(background(80, 60)));
  assert.equal(wrong.status, 200); assert.equal(wrong.json.yuan, 0); assert.deepEqual(wrong.json.issues, []);
  assert.ok(wrong.json.warnings.includes(sceneRatioNotes('9:16', { width: 80, height: 60 })[0]));
  const right = await s.call('POST', '/api/video-rewrite/prompt', body(background(90, 160)));
  assert.ok(!right.json.warnings.some(text => text.startsWith('背景图是')));
});
