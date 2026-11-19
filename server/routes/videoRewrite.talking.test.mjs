// 11-19「露脸 · AI 自己配音」走真接口（app.handler、假拆解、不花钱）：拆解带台词 → 写词放进 {} → 免费检查一字不差。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../videoRewrite/routeTestKit.mjs';

const speech = async () => [[0.1, 1.9], [2.1, 8.4]];

test('说话版整条：拆解回台词、写词有声音约束和每句台词、检查零问题；改了台词不写进提示词就被检查拦下', async () => {
  const s = setup({ sheets: { speech } }), source = s.upload(8.4);
  const analyzed = await s.call('POST', '/api/video-rewrite/analyze', { cardId: 'talk-1', source, userText: '人物换成我的', talking: true });
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.json));
  const { plan } = analyzed.json;
  assert.equal(plan.lines.length, 3); assert.equal(plan.lines[0].who, '镜头外');
  const materials = s.images([{ tag: '@图片1', purpose: '人物', itemId: 'P1', originalDesc: plan.items[0].desc }, { tag: '@视频1', purpose: '深度' }]);
  const written = await s.call('POST', '/api/video-rewrite/prompt', { cardId: 'talk-1', plan, materials, ratio: '9:16', userText: '人物换成我的',
    duration: 8, sourceDuration: 8.4, talking: true, voice: '清亮的年轻男声' });
  assert.equal(written.status, 200, JSON.stringify(written.json));
  assert.deepEqual(written.json.issues, []);
  assert.match(written.json.videoPrompt, /^声音约束：/);
  for (const line of plan.lines) assert.ok(written.json.videoPrompt.includes(`{${line.text}}`), line.text);
  assert.match(written.json.videoPrompt, /说话的声音是清亮的年轻男声。/);
  const check = lines => s.call('POST', '/api/video-rewrite/check', { cardId: 'talk-1', duration: 8, materials, videoPrompt: written.json.videoPrompt, changeSeconds: [], lines });
  assert.deepEqual((await check(plan.lines.map(line => ({ text: line.text })))).json.issues, []);
  const changed = await check([{ text: '换了一句新台词' }, ...plan.lines.slice(1).map(line => ({ text: line.text }))]);
  assert.ok(changed.json.issues.some(issue => issue.includes('台词「换了一句新台词」没原样写进提示词')));
});

test('说话版拦截：没认出字幕铺的空行不填就不让写词；台词表空的也拦；不是说话版的请求不受影响', async () => {
  const s = setup({ sheets: { speech } }), source = s.upload(8.4);
  const { plan } = (await s.call('POST', '/api/video-rewrite/analyze', { cardId: 'talk-2', source, userText: '假无字幕', talking: true })).json;
  assert.deepEqual(plan.lines.map(line => line.text), ['', '']);
  const materials = s.images([{ tag: '@图片1', purpose: '人物', itemId: 'P1' }, { tag: '@视频1', purpose: '深度' }]);
  const body = { cardId: 'talk-2', plan, materials, ratio: '9:16', userText: '换人', duration: 8, sourceDuration: 8.4, talking: true };
  const blank = await s.call('POST', '/api/video-rewrite/prompt', body);
  assert.equal(blank.status, 400); assert.match(blank.json.error, /没填字/);
  const empty = await s.call('POST', '/api/video-rewrite/prompt', { ...body, plan: { ...plan, lines: [] } });
  assert.equal(empty.status, 400); assert.match(empty.json.error, /台词表是空的/);
  const plain = await s.call('POST', '/api/video-rewrite/prompt', { ...body, talking: undefined, plan: { ...plan, lines: undefined } });
  assert.equal(plain.status, 200); assert.doesNotMatch(plain.json.videoPrompt, /声音约束|\{/);
});
