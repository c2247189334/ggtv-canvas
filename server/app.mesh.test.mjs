import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.mjs';
import { tempDir, waitFor } from './testKit.mjs';
import { solidPng } from './png.mjs';
import { pruneUploads } from './cleanup.mjs';

const sourceBytes = readFileSync(new URL('./fixtures/audio-video.mp4', import.meta.url));
// 白模成品最多 25fps（10-31 用户定）：假执行器写出的「输出」也要是 25fps，用真 ffmpeg 现做一份。
const meshPath = join(tempDir(), 'mesh-25.mp4');
execFileSync('ffmpeg', ['-v', 'error', '-i', fileURLToPath(new URL('./fixtures/depth-video.mp4', import.meta.url)), '-vf', 'fps=25',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', meshPath]);
const meshBytes = readFileSync(meshPath);
function setup(extra = {}) {
  const calls = []; let stopped = 0;
  const executor = { run: async (command, args) => { calls.push({ command, args }); writeFileSync(args.at(-1), meshBytes); },
    stop: () => { stopped++; } };
  const app = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake: true, readEnv: () => ({}), executor, ...extra });
  const source = { type: 'upload', id: app.stores.uploads.save(sourceBytes).id };
  async function request(path, body) {
    const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
      url: path, method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:5290', 'content-type': 'application/json' }
    });
    const chunks = []; let status;
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.writeHead = code => { status = code; };
    await app.handler(req, res);
    return { status, json: JSON.parse(Buffer.concat(chunks).toString()) };
  }
  return { app, source, request, calls, stopped: () => stopped };
}

test('假白模通过应用接线：来源→单子→作品mesh标记→查单元数据，不触发ComfyUI，退出停执行器', async () => {
  const s = setup();
  try {
    const submitted = await s.request('/api/mesh-jobs', { source: s.source, cardId: 'mesh-card' });
    assert.equal(submitted.status, 200);
    let job;
    await waitFor(() => { job = s.app.stores.jobs.read(submitted.json.id); return ['succeeded', 'failed'].includes(job.status); });
    assert.equal(job.status, 'succeeded', job.error);
    assert.equal(job.kind, 'mesh'); assert.equal(job.yuan, 0);
    assert.equal(s.calls.length, 1); assert.equal(s.calls[0].command, 'ffmpeg');
    assert.ok(s.calls[0].args.some(value => value.includes('negate')));
    const works = (await s.request('/api/works')).json;
    assert.equal(works.length, 1); assert.equal(works[0].mesh, true); assert.equal(works[0].depth, undefined);
    assert.equal(works[0].model, 'SAM-3D-Body'); assert.equal(works[0].yuan, 0); assert.deepEqual(works[0].source, s.source);
    const view = (await s.request(`/api/jobs?ids=${job.id}`)).json[0];
    assert.equal(view.workMeta[0].width, 864); assert.equal(view.workMeta[0].height, 480); assert.equal(view.workMeta[0].fps, 25);
    assert.equal(view.workMeta[0].hasAudio, false);
  } finally { s.app.depthQueue.stop(); }
  assert.equal(s.stopped(), 1);
});

test('白模接口来源和30秒限制在执行前拦截，无清晰度参数', async () => {
  const s = setup();
  try {
    const image = { type: 'upload', id: s.app.stores.uploads.save(solidPng(2, 2, [0, 0, 0])).id };
    const long = Buffer.from(sourceBytes), mvhd = long.indexOf(Buffer.from('mvhd')) + 4;
    long.writeUInt32BE(31 * long.readUInt32BE(mvhd + 12), mvhd + 16);
    const tooLong = { type: 'upload', id: s.app.stores.uploads.save(long).id };
    for (const [body, error] of [[{}, /视频来源/], [{ source: image }, /请选择一个视频/], [{ source: tooLong }, /原片超过 30 秒/],
      [{ source: s.source, resolution: '480p' }, /白模.*480/], [{ source: s.source, canvasId: 'bad' }, /画布编号/]]) {
      const rejected = await s.request('/api/mesh-jobs', body); assert.equal(rejected.status, 400); assert.match(rejected.json.error, error);
    }
    assert.equal(s.calls.length, 0); assert.equal(s.app.stores.jobs.list().length, 0);
  } finally { s.app.depthQueue.stop(); }
});

test('只有白模作品引用时，启动清理仍保留来源视频', () => {
  const s = setup();
  try {
    const work = s.app.stores.works.addVideo(meshBytes, { mesh: true, source: s.source });
    assert.equal(work.mesh, true);
    const result = pruneUploads({ ...s.app.stores, canvases: { docs: () => [] } });
    assert.equal(result.removed, 0); assert.ok(s.app.stores.uploads.path(s.source.id));
  } finally { s.app.depthQueue.stop(); }
});

test('应用把白模原始错误写到注入的小服务日志，查单只有中文操作说明', async () => {
  const logs = [];
  const s = setup({ logError: (tag, error) => logs.push([tag, error.message]),
    executor: { run: async () => { throw Error('ffmpeg technical test detail'); }, stop: () => {} } });
  try {
    const submitted = await s.request('/api/mesh-jobs', { source: s.source });
    assert.equal(submitted.status, 200);
    await waitFor(() => s.app.stores.jobs.read(submitted.json.id)?.status === 'failed');
    const job = (await s.request(`/api/jobs?ids=${submitted.json.id}`)).json[0];
    assert.doesNotMatch(job.error, /technical test detail/);
    assert.match(job.error, /^本地处理失败，没有自动重跑，花费 0。\n.*。$/);
    assert.ok(logs.some(([, raw]) => raw.includes('technical test detail')));
    assert.equal(s.app.stores.spend.totalOn(new Date()), 0);
  } finally { s.app.depthQueue.stop(); }
});
