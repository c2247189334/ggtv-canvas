import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { setup } from '../videoRewrite/routeTestKit.mjs';
import { imageTemplate } from '../videoRewrite/roles.mjs';
import { outfitChangeSeconds } from '../videoRewrite/rules.mjs';

test('当前生成时长与原片拆解时长分开，缩短到10秒仍出连续时间轴且零问题', async () => {
  const s = setup();
  const { plan } = (await s.call('POST', '/api/video-rewrite/analyze', { cardId: 'short-1', source: s.upload(15.05), userText: '换人换衣' })).json;
  const materials = s.images([{ tag: '@图片1', purpose: '背景' },
    ...plan.replace.map((id, index) => ({ tag: `@图片${index + 2}`, itemId: id, purpose: plan.items.find(item => item.id === id).kind })),
    { tag: '@视频1', purpose: '深度' }]);
  const result = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'short-1', plan, materials, ratio: '9:16', userText: '用我的图片',
    duration: 10, sourceDuration: 15.05 });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.issues, []);
  assert.match(result.json.videoPrompt, /9-10秒/);
  assert.ok(!result.json.videoPrompt.includes('12-13秒'));
});

test('app.handler假全流程：拆解、按要换项铺图片卡模板、真实假出图补齐、代码拼词和免费检查零问题，拼词不花钱', async () => {
  const s = setup(), source = s.upload(15.05);
  const canvas = await s.call('POST', '/api/canvases', { name: '两步回归' });
  const analyzed = await s.call('POST', '/api/video-rewrite/analyze', { cardId: 'flow-1', source, userText: '人物衣服换成我的' });
  assert.equal(analyzed.status, 200);
  const { plan } = analyzed.json;
  assert.deepEqual(plan.replace, ['P1', 'C1', 'C2', 'C3', 'C4'], '要拉出来补图的：人 + 4 套衣服');
  const cards = [{ tag: '@图片1', purpose: '背景', prompt: '同一个房间，室内背景' }, ...plan.replace.map((id, index) => {
    const item = plan.items.find(row => row.id === id);
    return { tag: `@图片${index + 2}`, itemId: id, purpose: item.kind, originalDesc: item.desc, prompt: imageTemplate(item.kind) };
  })];
  const materials = [];
  for (const [index, card] of cards.entries()) {
    const submitted = await s.call('POST', '/api/jobs', { canvasId: canvas.json.id, cardId: `picture-${index}`, model: 'doubao-seedream-5-0-flash-260915',
      prompt: card.prompt, size: '1024x1024', count: 1, refs: [] });
    assert.equal(submitted.status, 200);
    let job;
    const deadline = Date.now() + 5000;
    do {
      job = (await s.call('GET', `/api/jobs?ids=${submitted.json.id}`)).json[0];
      if (job.status === 'succeeded' || job.status === 'failed') break;
      await setTimeout(5);
    } while (Date.now() < deadline);
    assert.equal(job.status, 'succeeded', JSON.stringify(job));
    const { prompt, ...material } = card;
    assert.ok(prompt);
    materials.push({ ...material, asset: { type: 'work', id: job.works[0] } });
  }
  materials.push({ tag: '@视频1', purpose: '深度' }, { tag: '@音频1', purpose: '原声' });
  const before = s.app.stores.spend.totalOn();
  const written = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'flow-1', duration: 15.05, ratio: '9:16', plan, materials, userText: '用我的图片' });
  assert.equal(written.status, 200); assert.equal(written.json.yuan, 0); assert.deepEqual(written.json.issues, []);
  assert.ok(!written.json.videoPrompt.includes('吊扇叶片'), '画面里的东西不写进提示词');
  assert.ok(written.json.warnings.some(text => text.startsWith('拆解认出画面里还有吊扇叶片')));
  assert.match(written.json.videoPrompt, /@图片2是人物：只采用脸、发型（黑色短发）和身材/, '假看图结果填进人物那句');
  assert.equal(s.app.stores.spend.totalOn(), before);
  const checked = await s.call('POST', '/api/video-rewrite/check', { cardId: 'flow-1', duration: 15.05,
    materials, videoPrompt: written.json.videoPrompt, changeSeconds: outfitChangeSeconds(plan) });
  assert.equal(checked.status, 200); assert.deepEqual(checked.json.issues, []);
});
