import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentEnv, setup } from '../videoRewrite/routeTestKit.mjs';
import { fakeClaudeLogin, tempDir } from '../testKit.mjs';
import { planFixture, materialFixture } from './productFixture.mjs';

const analyzeBody = source => ({ cardId: 'product-1', source, userText: '鞋子' });
const promptBody = s => ({ cardId: 'product-1', plan: planFixture(), userText: '鞋子', duration: 15, sourceDuration: 15,
  ratio: '9:16', model: 'doubao-seedance-2-0-260128', materials: s.images(materialFixture()) });

test('假模式商品拆解→单次看图拼词→免费检查→Claude示例，零费用并清中间目录', async () => {
  const s = setup();
  assert.equal((await s.call('GET', '/api/product-remake/estimates')).status, 404, '11-15 不再有豆包估价');
  const analysis = await s.call('POST', '/api/product-remake/analyze', analyzeBody(s.upload(15)));
  assert.equal(analysis.status, 200, JSON.stringify(analysis.json));
  assert.equal(analysis.json.plan.products[0].name, '鞋子'); assert.equal(analysis.json.plan.products[0].pairs, 1);
  assert.equal(analysis.json.plan.products[0].pieces, 2); assert.equal(analysis.json.targetDuration, 15);
  assert.equal(analysis.json.yuan, 0);
  assert.equal(s.mediaCalls.length, 1); assert.equal(s.frameCalls.length, 1); assert.equal(s.frameCalls[0].length, 6);
  const input = { ...promptBody(s), plan: analysis.json.plan };
  const written = await s.call('POST', '/api/product-remake/prompt', input);
  assert.equal(written.status, 200, JSON.stringify(written.json)); assert.deepEqual(written.json.issues, []);
  assert.match(written.json.videoPrompt, /@视频1 是参考视频/); assert.match(written.json.videoPrompt, /米白/);
  const check = await s.call('POST', '/api/product-remake/check', { ...input, videoPrompt: written.json.videoPrompt });
  assert.equal(check.status, 200); assert.deepEqual(check.json.issues, []);
  assert.equal(written.json.finalized, false, '假模式不看图定稿');
  assert.equal(existsSync(join(s.root, '改写', 'product-1')), false); assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('假拆解失败原话与0费用回传，缺图/坏来源/坏ID/缺本机 agent 不调用模型', async () => {
  const s = setup();
  const failed = await s.call('POST', '/api/product-remake/analyze', { ...analyzeBody(s.upload(6)), userText: '假拆解失败' });
  assert.equal(failed.status, 502); assert.match(failed.json.error, /假拆解失败/); assert.equal(failed.json.yuan, 0);
  assert.equal(existsSync(join(s.root, '改写', 'product-1')), false);
  const body = promptBody(s); delete body.materials[1].asset;
  assert.equal((await s.call('POST', '/api/product-remake/prompt', body)).status, 400);
  for (const duration of [3.9, 30.1]) assert.equal((await s.call('POST', '/api/product-remake/analyze', analyzeBody(s.upload(duration)))).status, 400);
  assert.equal((await s.call('POST', '/api/product-remake/analyze', { ...analyzeBody(s.upload(6)), cardId: '../x' })).status, 400);
  let calls = 0;
  const noAgent = setup({ fake: false, readEnv: () => ({}), claude: async () => { calls++; throw Error('不能调用'); } });
  const refused = await noAgent.call('POST', '/api/product-remake/analyze', analyzeBody(noAgent.upload(6)));
  assert.equal(refused.status, 400); assert.match(refused.json.error, /Claude 或 Codex/);
  const unwritten = await noAgent.call('POST', '/api/product-remake/prompt', promptBody(noAgent));
  assert.equal(unwritten.status, 400); assert.match(unwritten.json.error, /本机 Claude 没配好/);
  assert.equal(calls, 0); assert.equal(noAgent.mediaCalls.length, 0);
});

test('本机 agent 拆解只问一次：坏回话原话脱敏回给页面、记 0 元；看图失败不回提示词', async t => {
  const localEnv = agentEnv(t); let calls = 0;
  const s = setup({ fake: false, readEnv: () => localEnv, claude: async () => { calls++; return { text: `坏JSON ${localEnv.ARK_API_KEY}`, model: 'claude-local', usage: { input_tokens: 1, output_tokens: 1 } }; } });
  const reply = await s.call('POST', '/api/product-remake/analyze', analyzeBody(s.upload(15)));
  assert.equal(reply.status, 502); assert.equal(calls, 1); assert.equal(reply.json.yuan, 0);
  assert.ok(reply.json.error.includes('坏JSON ***'), reply.json.error); assert.equal(s.app.stores.spend.totalOn(), 0);
  const broken = setup({ fake: false, readEnv: () => localEnv, claude: async () => { throw Error('Claude 调用失败：断线'); } });
  const down = await broken.call('POST', '/api/product-remake/prompt', promptBody(broken));
  assert.equal(down.status, 502); assert.match(down.json.error, /断线/); assert.equal(down.json.yuan, 0);
  assert.equal(down.json.videoPrompt, undefined);
});

test('同卡互斥覆盖两种拆解，409不删除进行中目录，完成后才清理', { timeout: 2000 }, async () => {
  let entered, release;
  const start = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const s = setup({ sheets: { cuts: async () => { entered(); await gate; return []; } } });
  const body = analyzeBody(s.upload(15)), pending = s.call('POST', '/api/product-remake/analyze', body);
  await start;
  assert.equal((await s.call('POST', '/api/product-remake/analyze', body)).status, 409);
  assert.equal((await s.call('POST', '/api/video-rewrite/analyze', body)).status, 409);
  assert.equal(existsSync(join(s.root, '改写', 'product-1')), true);
  release(); assert.equal((await pending).status, 200); assert.equal(existsSync(join(s.root, '改写', 'product-1')), false);
});

test('本机Claude就绪自动0元，拆解/看商品图/看图定稿使用同框架；定稿用商品版清单、只抽原片本身', async t => {
  t.after(fakeClaudeLogin());
  const bin = join(tempDir(), 'claude.exe'); writeFileSync(bin, '');
  const calls = [], localEnv = { CLAUDE_CLI: bin };
  const claude = async input => { calls.push(input); return { text: input.system.includes('提示词定稿员')
    ? JSON.stringify({ prompt: input.files.find(file => file.name === '底稿.txt').buffer.toString(), changes: [], unfixable: [{ what: '原片有脸', fix: '可能被拦' }] })
    : JSON.stringify(input.prompt.includes('features') ? { products: [{ id: 'A', features: '米白低帮鞋', wear: '直接套脚' }] } : planFixture()),
  model: 'claude-local', elapsedMs: 1, usage: { input_tokens: 10, output_tokens: 5 } }; };
  const s = setup({ fake: false, readEnv: () => localEnv, claude });
  const analyzed = await s.call('POST', '/api/product-remake/analyze', analyzeBody(s.upload(15)));
  assert.equal(analyzed.status, 200); assert.equal(analyzed.json.yuan, 0); assert.equal(analyzed.json.model, 'claude-local');
  const body = promptBody(s); body.materials[0].asset = s.upload(15);
  const written = await s.call('POST', '/api/product-remake/prompt', body);
  assert.equal(written.status, 200); assert.equal(written.json.yuan, 0); assert.match(written.json.videoPrompt, /米白低帮鞋/);
  assert.deepEqual(calls[1].files.map(file => file.name), ['商品图-1.jpg', '商品图-2.jpg', '商品图-3.jpg']);
  assert.equal(written.json.finalized, true); assert.deepEqual(written.json.issues, []);
  assert.ok(written.json.warnings.includes('Claude 看图发现改字解决不了：原片有脸（建议：可能被拦）'), written.json.warnings.join('|'));
  assert.equal(calls.length, 3); assert.match(calls[2].system, /商品外观只照商品实物照/); assert.match(calls[2].system, /数量和摆位/);
  assert.doesNotMatch(calls[2].system, /换白模/);
  const names = calls[2].files.map(file => file.name);
  assert.ok(names.includes('视频1_0.0s.jpg') && !names.some(name => name.startsWith('原片_')), names.join(','));
  assert.match(calls[2].files.find(file => file.name === '素材表.txt').buffer.toString(), /原片本身/);
  assert.equal(s.app.stores.spend.totalOn(), 0);
});

test('缺某个商品组的图在看图前拒绝，未知身份图片进免费检查标红，原look/now同样标红', async () => {
  const s = setup(), body = promptBody(s);
  body.plan.products.push({ id: 'B', name: '包', look: '红色皮革手提包', pairs: 0, pieces: 1, layout: '右侧' });
  const missing = await s.call('POST', '/api/product-remake/prompt', body);
  assert.equal(missing.status, 400); assert.match(missing.json.error, /商品B/);
  body.plan.products.pop();
  body.materials.push({ tag: '@图片4', purpose: '无身份', asset: s.picture() });
  const generated = await s.call('POST', '/api/product-remake/prompt', body);
  assert.equal(generated.status, 200); assert.doesNotMatch(generated.json.videoPrompt, /@图片4/);
  assert.ok(generated.json.issues.includes('@图片4 没身份：放进商品组或剪掉连线'));
  const result = await s.call('POST', '/api/product-remake/check', { ...body,
    videoPrompt: generated.json.videoPrompt + '原片黑色厚底鞋。米黄格纹地砖。' });
  assert.equal(result.status, 200); assert.ok(result.json.issues.some(issue => issue.includes('原片黑色厚底鞋')));
  assert.ok(result.json.issues.some(issue => issue.includes('米黄格纹地砖')));
});

test('11-04 晚「跟商品A一样」的组没图也能拼词，指向不存在的商品或自己就拒绝', async () => {
  const s = setup(), body = promptBody(s);
  body.plan.products.push({ id: 'B', name: '鞋子', where: '后排上层', look: '', pairs: 1, pieces: 2, layout: '后排上层', sameAs: 'A' });
  const ok = await s.call('POST', '/api/product-remake/prompt', body);
  assert.equal(ok.status, 200); assert.match(ok.json.videoPrompt, /商品B（后排上层那组）和商品A同款同色/);
  body.plan.products[1].sameAs = 'C';
  assert.equal((await s.call('POST', '/api/product-remake/prompt', body)).status, 400);
  body.plan.products[1].sameAs = 'B';
  assert.equal((await s.call('POST', '/api/product-remake/prompt', body)).status, 400);
});
