import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createApp } from '../app.mjs';
import { tempDir } from '../testKit.mjs';
import { solidPng } from '../png.mjs';
import { createExecutor } from '../depth/executor.mjs';

function setup(overrides = {}) {
  let calls = 0;
  const logged = [];
  // 照真执行器的格式：「命令 退出码 n」+ 原文（server/depth/executor.mjs）。
  const executor = { run: async () => { calls++; throw Error('ffmpeg 退出码 1\n测试执行器失败原话'); }, stop: () => {} };
  const app = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake: true,
    readEnv: () => ({}), executor, logError: (label, error) => { logged.push(`${label}: ${error.message}`); }, ...overrides });
  const source = { type: 'upload', id: app.stores.uploads.save(readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url))).id };
  async function post(body) {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { url: '/api/video-clips', method: 'POST', headers: { host: '127.0.0.1:5290', 'content-type': 'application/json' } });
    const chunks = [], res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    let status;
    res.writeHead = value => { status = value; };
    await app.handler(req, res);
    return { status, json: JSON.parse(Buffer.concat(chunks).toString()) };
  }
  return { app, source, post, logged, calls: () => calls };
}

test('片段接口：每种400返回中文，拒收之前不执行ffmpeg', async () => {
  const s = setup();
  const image = { type: 'upload', id: s.app.stores.uploads.save(solidPng(2, 2, [0, 0, 0])).id };
  const cases = [
    [{}, /视频来源/], [{ source: { type: 'url', id: s.source.id } }, /视频来源/],
    [{ source: { type: 'upload', id: '../x' } }, /视频来源/],
    [{ source: { type: 'upload', id: '00000000-0000-4000-8000-000000000000' } }, /找不到/],
    [{ source: { type: 'work', id: '00000000-0000-4000-8000-000000000000' } }, /作品已删除/],
    [{ source: image }, /请选择一个视频/],
    [{ source: s.source, start: null, end: 1 }, /有限数字/],
    [{ source: s.source, start: 0, end: '1' }, /有限数字/],
    [{ source: s.source, start: -0.1, end: 1 }, /不能小于 0/],
    [{ source: s.source, start: 0, end: 2.02 }, /超过视频时长/],
    [{ source: s.source, start: 0.4, end: 1.3 }, /截取的片段至少要 1 秒。/],
    [{ source: s.source, start: 1.009, end: 2.009 }, /截取的片段至少要 1 秒。/],
    [{ source: s.source, start: 0, end: 1, canvasId: 'bad' }, /画布编号/],
    [{ source: s.source, start: 0, end: 1, cardId: '../bad' }, /卡片编号/]
  ];
  for (const [body, message] of cases) {
    const result = await s.post(body);
    assert.equal(result.status, 400, JSON.stringify(result));
    assert.match(result.json.error, message);
  }
  assert.equal(s.calls(), 0);
});

test('片段接口：不套30秒上限；容差0.01秒内允许；失败只返回本地中文，执行器原话不上页面', async () => {
  const s = setup();
  const bytes = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
  const mvhd = bytes.indexOf(Buffer.from('mvhd')) + 4;
  bytes.writeUInt32BE(900 * bytes.readUInt32BE(mvhd + 12), mvhd + 16);
  // 此处只验范围通过后执行器失败；长素材的画面时长也必须是900秒，不能造出898秒纯音轨尾巴。
  const tkhd = bytes.indexOf(Buffer.from('tkhd')) + 4;
  assert.equal(bytes[tkhd], 0);
  bytes.writeUInt32BE(900 * bytes.readUInt32BE(mvhd + 12), tkhd + 20);
  const source = { type: 'upload', id: s.app.stores.uploads.save(bytes).id };
  assert.equal(s.app.stores.uploads.metadata(source.id).videoDuration, 900);
  for (const body of [{ source, start: 898, end: 900 }, { source: s.source, start: 0, end: 2.009 },
    { source: s.source, start: 0.4, end: 1.4 }]) {
    const result = await s.post(body);
    assert.equal(result.status, 500); assert.match(result.json.error, /本地处理失败[\s\S]*详情见小服务日志/);
    assert.doesNotMatch(result.json.error, /测试执行器失败原话/);
  }
  assert.equal(s.calls(), 3);
  assert.equal(s.logged.length, 3); assert.ok(s.logged.every(line => line.includes('测试执行器失败原话')));
});

test('片段接口真实ffmpeg直接handler：上传/作品视频都截成上传素材并返回完整元数据，不入作品库', async () => {
  const executor = createExecutor(), s = setup({ executor });
  try {
    const bytes = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
    const work = s.app.stores.works.addVideo(bytes, {});
    for (const source of [s.source, { type: 'work', id: work.id }]) {
      const response = await s.post({ source, start: 0.4, end: 1.6, cardId: 'source-card' });
      assert.equal(response.status, 200, JSON.stringify(response));
      const saved = response.json;
      assert.ok(saved.id); assert.equal(saved.kind, 'video');
      assert.equal(saved.width, 864); assert.equal(saved.height, 480); assert.equal(saved.fps, 30); assert.equal(saved.hasAudio, true);
      assert.ok(Math.abs(saved.duration - 1.2) <= 1 / 30 + 0.05, JSON.stringify(saved));
      assert.equal(s.app.stores.uploads.metadata(saved.id).hasAudio, true);
    }
    assert.equal(s.app.stores.works.list().length, 1);
  } finally { executor.stop(); }
});
