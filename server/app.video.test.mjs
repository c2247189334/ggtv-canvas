import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApp } from './app.mjs';
import { createFakeArk } from './fakeArk.mjs';
import { createFakeSeedance } from './fakeSeedance.mjs';
import { call, listen, tempDir, waitFor } from './testKit.mjs';
import { solidPng } from './png.mjs';

const fixture = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
// 原fixture是320×180，不符合参考像素下限。只改测试副本的tkhd元数据，原文件不动。
const reference = Buffer.from(fixture);
const tkhd = reference.indexOf(Buffer.from('tkhd')) - 4;
const tkhdEnd = tkhd + reference.readUInt32BE(tkhd);
reference.writeUInt32BE(1280 * 65536, tkhdEnd - 8);
reference.writeUInt32BE(720 * 65536, tkhdEnd - 4);
const json = { 'Content-Type': 'application/json' };
const post = (port, path, data) => call(port, { method: 'POST', path, headers: json, body: JSON.stringify(data) });
const upload = (port, bytes = reference, type = 'video/mp4') => call(port, {
  method: 'POST', path: '/api/uploads', headers: { 'Content-Type': type }, body: bytes
});
const request = (canvasId, extra = {}) => ({ canvasId, cardId: 'video-card',
  model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', prompt: '海边一只猫',
  ratio: '16:9', resolution: '480p', duration: 5, audio: true, refs: [], ...extra });
async function boot({ fake = true, env = {}, dataRoot = tempDir(), client } = {}) {
  const videoClient = client ?? createFakeSeedance({ delayMs: 5 });
  const app = createApp({ dataRoot, distDir: tempDir(), port: 5290, fake, readEnv: () => env,
    generate: createFakeArk({ delayMs: 1 }), videoClient, videoPollMs: 1,
    logError: () => {}, log: () => {} });
  return { app, ...await listen(app.handler) };
}
async function done(s, id) {
  let view;
  await waitFor(async () => {
    view = (await call(s.port, { path: `/api/jobs?ids=${id}` })).json[0];
    return ['succeeded', 'failed', 'uncertain'].includes(view.status);
  });
  return view;
}

test('视频整条：上传 → 交单 → 成功 → 作品 → Range → mp4下载名', async () => {
  const s = await boot();
  try {
    const canvas = (await post(s.port, '/api/canvases', { name: 'video' })).json;
    const up = await upload(s.port);
    assert.equal(up.status, 200);
    assert.equal(up.json.kind, 'video');
    assert.equal(up.json.duration, 2);
    assert.equal(up.json.width, 1280);
    const job = await post(s.port, '/api/video-jobs', request(canvas.id, { refs: [{ type: 'upload', id: up.json.id }] }));
    assert.equal(job.status, 200);
    const view = await done(s, job.json.id);
    assert.equal(view.kind, 'video');
    assert.equal(view.status, 'succeeded');
    assert.deepEqual(view.blocked, []);
    const works = (await call(s.port, { path: '/api/works' })).json;
    assert.equal(works[0].kind, 'video');
    assert.equal(works[0].id, view.works[0]);
    assert.ok(Math.abs(works[0].yuan - 0.984312) < 1e-9); // 2秒参考+5秒输出、含视频单价
    const part = await call(s.port, { path: `/api/works/file?id=${works[0].id}`, headers: { Range: 'bytes=4-11' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers['content-range'], `bytes 4-11/${fixture.length}`);
    assert.deepEqual(part.buffer, fixture.subarray(4, 12));
    const download = await call(s.port, { path: `/api/works/file?id=${works[0].id}&download=1` });
    assert.match(download.headers['content-disposition'], /\.mp4/);
  } finally { await s.close(); }
});

test('假被拦返回failed和blocked[1]；假超时不明；假任务失败不收费', async () => {
  const s = await boot();
  try {
    const canvas = (await post(s.port, '/api/canvases', { name: 'c' })).json;
    const png = (await upload(s.port, solidPng(8, 8, [1, 2, 3]), 'image/png')).json;
    for (const [prompt, status] of [['假被拦', 'failed'], ['假超时', 'uncertain'], ['假任务失败', 'failed'], ['假失败', 'failed']]) {
      const job = await post(s.port, '/api/video-jobs', request(canvas.id, { prompt, refs: [{ type: 'upload', id: png.id }] }));
      assert.equal(job.status, 200);
      const view = await done(s, job.json.id);
      assert.equal(view.status, status);
      if (prompt === '假被拦') {
        assert.deepEqual(view.blocked, [1]);
        assert.match(view.error, /参考 1.*真人.*没扣钱/);
      }
    }
    assert.equal((await call(s.port, { path: '/api/health' })).json.todayYuan, 0);
  } finally { await s.close(); }
});

test('真模式缺ARK先拒；带参考视频缺TOS先拒；health只报填写状态', async () => {
  for (const env of [{}, { ARK_API_KEY: 'fake-test-only' }]) {
    let submits = 0;
    const s = await boot({ fake: false, env, client: { submit: async () => { submits++; } } });
    try {
      const canvas = (await post(s.port, '/api/canvases', { name: 'c' })).json;
      const up = (await upload(s.port)).json;
      const job = await post(s.port, '/api/video-jobs', request(canvas.id, { refs: [{ type: 'upload', id: up.id }] }));
      assert.equal(job.status, 400);
      assert.match(job.json.error, env.ARK_API_KEY ? /TOS_/ : /ARK_API_KEY/);
      assert.equal(submits, 0);
      const originalFetch = globalThis.fetch, probes = [];
      globalThis.fetch = async (url, options) => {
        probes.push({ url: String(url), redirect: options.redirect, signal: options.signal });
        return new Response('{}', { status: 503 });
      };
      try {
        const health = (await call(s.port, { path: '/api/health' })).json;
        assert.equal(health.tosReady, false);
        assert.ok(!JSON.stringify(health).includes('fake-test-only'));
        assert.equal(health.mesh.ready, false);
        assert.deepEqual(probes.map(probe => probe.url), ['http://127.0.0.1:8188/system_stats']);
        assert.equal(probes[0].redirect, 'error');
        assert.ok(probes[0].signal instanceof AbortSignal);
      } finally { globalThis.fetch = originalFetch; }
    } finally { await s.close(); }
  }
});

test('重启拼装：已拿号只查；提交没号不明；上传阶段重新排', async () => {
  const root = tempDir();
  const first = await boot({ dataRoot: root });
  const body = request('11111111-1111-4111-8111-111111111111');
  const waiting = first.app.stores.jobs.create({ ...body, kind: 'video', priceYuan: 1.15506 });
  const uncertain = first.app.stores.jobs.create({ ...body, kind: 'video', priceYuan: 1.15506 });
  const uploading = first.app.stores.jobs.create({ ...body, kind: 'video', priceYuan: 1.15506 });
  first.app.stores.jobs.patch(waiting.id, { status: 'running', phase: 'waiting', taskId: 'known', submitStartedAt: 'yes' });
  first.app.stores.jobs.patch(uncertain.id, { status: 'running', phase: 'submitting', submitStartedAt: 'yes' });
  first.app.stores.jobs.patch(uploading.id, { status: 'running', phase: 'uploading' });
  await first.close();
  let submits = 0;
  const second = await boot({ dataRoot: root, client: {
    submit: async () => { submits++; return { ok: true, taskId: 'new' }; },
    query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' }, usage: { completion_tokens: 50220 } }),
    download: async () => fixture
  } });
  try {
    assert.equal(second.app.queue.recover(), 0);
    assert.equal(second.app.videoQueue.recover(), 3);
    second.app.queue.pump(); second.app.videoQueue.pump();
    assert.equal((await done(second, uncertain.id)).status, 'uncertain');
    assert.equal((await done(second, waiting.id)).status, 'succeeded');
    assert.equal((await done(second, uploading.id)).status, 'succeeded');
    assert.equal(submits, 1);
  } finally { await second.close(); }
});
