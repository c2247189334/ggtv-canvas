import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createApp } from '../app.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

// 11-15 付费单丢单：小服务接了单、页面没收到单号（回话丢了 / 正好切走画布），卡片上没记，这单就没人管了，用户再点一次会重复花钱。
// 新交的单先标「还没被画布记下」；画布存档里出现这个单号才算记下；没记下的可以按画布 + 卡片找回来。
const FLASH = 'doubao-seedream-5-0-flash-260915';
function setup() {
  const root = tempDir('orphan-jobs-');
  const app = createApp({ dataRoot: root, distDir: join(root, 'empty-page'), port: 5398, fake: true, readEnv: () => ({}),
    generate: async () => ({ ok: false, status: 500, message: '测试不出图' }), log: () => {}, logError: () => {} });
  return { app, jobs: app.stores.jobs, call: async (method, url, data) => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { method, url, headers: { host: '127.0.0.1:5398', 'content-type': 'application/json' } });
    let status; const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.writeHead = value => { status = value; }; await app.handler(req, res);
    return { status, json: JSON.parse(Buffer.concat(chunks).toString()) };
  } };
}
const orphans = (s, canvasId, cardIds) => s.call('GET', `/api/orphan-jobs?canvasId=${canvasId}&cardIds=${cardIds.join(',')}`);

test('交单时标成还没被画布记下；按画布和卡片能找回；画布存档里有了这个单号就不再算丢', async () => {
  const s = setup(), canvas = (await s.call('POST', '/api/canvases', { name: 'c' })).json;
  const sent = await s.call('POST', '/api/jobs', { canvasId: canvas.id, cardId: 'card-1', model: FLASH, prompt: 'x', size: '1024x1024', count: 1, refs: [] });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(s.jobs.read(sent.json.id).claimed, false);
  await waitFor(() => s.jobs.read(sent.json.id).status === 'failed');
  assert.equal(s.jobs.read(sent.json.id).claimed, false, '跑完也还是没记下');

  const found = await orphans(s, canvas.id, ['card-1', 'card-2']);
  assert.equal(found.status, 200);
  assert.deepEqual(found.json, [{ id: sent.json.id, cardId: 'card-1', kind: 'image' }]);

  // 存一次不带这个单号的画布：还算丢。
  const first = await s.call('PUT', `/api/canvas?id=${canvas.id}`, { ...canvas, baseVersion: 0, nodes: [{ id: 'card-1', data: { jobs: [] } }], edges: [] });
  assert.equal(first.status, 200);
  assert.equal((await orphans(s, canvas.id, ['card-1'])).json.length, 1);
  // 画布存档里记下了：不再算丢。
  const second = await s.call('PUT', `/api/canvas?id=${canvas.id}`, { ...canvas, baseVersion: 1,
    nodes: [{ id: 'card-1', data: { jobs: [sent.json.id, '不是编号', 7] } }, { id: 'bad' }, null], edges: [] });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(s.jobs.read(sent.json.id).claimed, true);
  assert.deepEqual((await orphans(s, canvas.id, ['card-1'])).json, []);
});

test('只找这张画布、这几张卡的图片单和视频单；老单子（没有这个标记）、本机单、别的画布都不算', async () => {
  const s = setup(), canvasId = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const video = s.jobs.create({ canvasId, cardId: 'v', kind: 'video', claimed: false, status: 'queued' });
  s.jobs.patch(video.id, { status: 'failed' });
  s.jobs.create({ canvasId, cardId: 'v', kind: 'video' });
  s.jobs.create({ canvasId, cardId: 'v', kind: 'depth', claimed: false });
  s.jobs.create({ canvasId: other, cardId: 'v', kind: 'video', claimed: false });
  s.jobs.create({ canvasId, cardId: 'not-asked', kind: 'video', claimed: false });
  s.jobs.create({ canvasId, cardId: 'v', kind: 'video', claimed: true });
  const found = await orphans(s, canvasId, ['v']);
  assert.deepEqual(found.json, [{ id: video.id, cardId: 'v', kind: 'video' }]);
  assert.equal((await orphans(s, 'bad', ['v'])).status, 400);
  assert.equal((await orphans(s, canvasId, ['../x'])).status, 400);
});

test('11-15 真页面验出来的：丢的单在打开画布前就跑完了，页面接回、一查就收走结果，单号不会再进存档——查到终态那一下就算记下；还在跑的不算', async () => {
  const s = setup(), canvasId = '11111111-1111-4111-8111-111111111111';
  const done = s.jobs.create({ canvasId, cardId: 'a', claimed: false }), running = s.jobs.create({ canvasId, cardId: 'b', kind: 'video', claimed: false });
  const local = s.jobs.create({ canvasId, cardId: 'c', kind: 'depth' });
  s.jobs.patch(done.id, { status: 'succeeded' }); s.jobs.patch(running.id, { status: 'running' }); s.jobs.patch(local.id, { status: 'succeeded' });
  const views = await s.call('GET', `/api/jobs?ids=${done.id},${running.id},${local.id}`);
  assert.deepEqual(views.json.map(view => view.status), ['succeeded', 'running', 'succeeded']);
  assert.equal(s.jobs.read(done.id).claimed, true); assert.equal(s.jobs.read(running.id).claimed, false);
  assert.equal('claimed' in s.jobs.read(local.id), false, '老单子和本机单不加这个标记');
  assert.deepEqual((await orphans(s, canvasId, ['a', 'b'])).json, [{ id: running.id, cardId: 'b', kind: 'video' }]);
});

test('视频交单也标成还没被画布记下', async () => {
  const s = setup(), canvas = (await s.call('POST', '/api/canvases', { name: 'c' })).json;
  s.app.videoQueue.pump = () => {};
  const sent = await s.call('POST', '/api/video-jobs', { canvasId: canvas.id, cardId: 'card-v', model: 'doubao-seedance-2-0-mini-260615', mode: 'reference',
    prompt: '一只猫', ratio: '16:9', resolution: '480p', duration: 5, audio: true, refs: [] });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(s.jobs.read(sent.json.id).claimed, false);
  assert.deepEqual((await orphans(s, canvas.id, ['card-v'])).json, [{ id: sent.json.id, cardId: 'card-v', kind: 'video' }]);
});
