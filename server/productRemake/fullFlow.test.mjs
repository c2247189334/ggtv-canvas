import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setup } from '../videoRewrite/routeTestKit.mjs';
import { createFakeSeedance } from '../fakeSeedance.mjs';
import { waitFor } from '../testKit.mjs';

test('无监听端口的假全流程：商品拆解→补图写词→免费检查→2.0参考交单→出片配回原声', async () => {
  const fake = createFakeSeedance({ delayMs: 0 }), sent = [];
  const client = { ...fake, submit: async request => { sent.push(request); return fake.submit(request); } };
  const s = setup({ videoClient: client, videoPollMs: 1 });
  const canvas = (await s.call('POST', '/api/canvases', { name: '商品完整假流程' })).json;
  const source = s.upload(6);
  // 只改测试临时副本的显示尺寸，与现有视频接口测试相同；原fixture保持不动。
  const path = s.app.stores.uploads.path(source.id), bytes = readFileSync(path);
  const start = bytes.indexOf(Buffer.from('tkhd')) - 4, end = start + bytes.readUInt32BE(start);
  bytes.writeUInt32BE(1280 * 65536, end - 8); bytes.writeUInt32BE(720 * 65536, end - 4); writeFileSync(path, bytes);
  const analyzed = await s.call('POST', '/api/product-remake/analyze', { cardId: 'full-product', source, userText: '鞋子' });
  assert.equal(analyzed.status, 200, JSON.stringify(analyzed.json));
  const materials = [{ tag: '@视频1', purpose: '参考视频', asset: source },
    { tag: '@图片1', purpose: '商品A', role: 'product', productId: 'A', asset: s.picture() }];
  const input = { cardId: 'full-product', plan: analyzed.json.plan, materials, userText: '鞋子', duration: 6,
    sourceDuration: 6, ratio: '16:9', model: 'doubao-seedance-2-0-260128' };
  const written = await s.call('POST', '/api/product-remake/prompt', input);
  assert.equal(written.status, 200); assert.deepEqual(written.json.issues, []);
  const checked = await s.call('POST', '/api/product-remake/check', { ...input, videoPrompt: written.json.videoPrompt });
  assert.deepEqual(checked.json.issues, []);
  const submitted = await s.call('POST', '/api/video-jobs', { canvasId: canvas.id, cardId: input.cardId, model: input.model,
    mode: 'reference', prompt: written.json.videoPrompt, ratio: input.ratio, resolution: '480p', duration: 6, audio: false,
    soundtrack: source, refs: materials.map(row => row.asset) });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
  let job;
  await waitFor(async () => {
    job = (await s.call('GET', `/api/jobs?ids=${submitted.json.id}`)).json[0];
    return ['succeeded', 'failed', 'uncertain'].includes(job.status);
  }, { timeout: 10000 });
  assert.equal(job.status, 'succeeded', JSON.stringify(job));
  assert.equal(sent.length, 1); assert.equal(sent[0].prompt, written.json.videoPrompt);
  assert.equal(sent[0].audio, false); assert.equal(sent[0].images.length, 1); assert.equal(sent[0].videos.length, 1);
  assert.equal(Object.hasOwn(sent[0], 'taskType'), false);
  const work = s.app.stores.works.metadata(job.works[0]);
  assert.equal(work.kind, 'video'); assert.equal(work.hasAudio, true);
});
