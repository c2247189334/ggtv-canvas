import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jobRoutes, jobView } from './jobs.mjs';
import { createJobStore } from '../store/jobs.mjs';
import { createWorkStore } from '../store/works.mjs';
import { solidPng } from '../png.mjs';
import { tempDir } from '../testKit.mjs';

test('查视频单返回真实作品元数据，删掉的作品跳过；图片单保持原状', async () => {
  const root = tempDir();
  const jobs = createJobStore(root), works = createWorkStore(root);
  const video = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
  const work = works.addVideo(video, {}), deleted = works.addVideo(video, {});
  works.remove(deleted.id);
  const videoJob = jobs.create({ kind: 'video' });
  jobs.patch(videoJob.id, { status: 'succeeded', works: [work.id, deleted.id] });
  const image = works.add(solidPng(2, 3, [1, 2, 3]), {});
  const imageJob = jobs.create({});
  jobs.patch(imageJob.id, { status: 'succeeded', works: [image.id] });
  const handlers = new Map();
  jobRoutes({ add: (method, path, handle) => handlers.set(`${method} ${path}`, handle) }, { jobs, works });
  let payload;
  await handlers.get('GET /api/jobs')({ query: new URLSearchParams({ ids: `${videoJob.id},${imageJob.id}` }), res: {
    writeHead: status => assert.equal(status, 200), end: text => { payload = JSON.parse(text); }
  } });
  assert.deepEqual(payload[0].workMeta, [{ id: work.id, duration: 2, width: 320, height: 180, fps:24,hasAudio:false }]);
  assert.deepEqual(payload[0].works, [work.id, deleted.id]);
  assert.deepEqual(payload[1], { id: imageJob.id, kind: 'image', status: 'succeeded', phase: null,
    blocked: [], createdAt: imageJob.createdAt, count: 1, works: [image.id], error: null });
});

test('health增加白模配置状态且假模式通过，不返回配置值', async () => {
  const handlers = new Map(); let payload;
  jobRoutes({ add: (method, path, handler) => handlers.set(`${method} ${path}`, handler) }, {
    jobs: { list: () => [] }, spend: { totalOn: () => 0 }, fake: true,
    readEnv: () => ({ COMFYUI_URL: 'http://127.0.0.1:8123', COMFYUI_DIR: 'private-local-folder' })
  });
  await handlers.get('GET /api/health')({ res: { writeHead: () => {}, end: text => { payload = JSON.parse(text); } } });
  assert.equal(payload.mesh.url.found, true); assert.equal(payload.mesh.directory.found, true);
  assert.ok(!JSON.stringify(payload).includes('private-local-folder')); assert.ok(!JSON.stringify(payload).includes('8123'));
});

test('网络进度提醒只属于视频生成协议，不给图片、深度或白模单添加字段', () => {
  const base = { id: 'job-1', status: 'running', works: [], warning: '暂时查不到进度' };
  for (const kind of [undefined, 'image', 'depth', 'mesh']) {
    assert.equal(Object.hasOwn(jobView({ ...base, kind }), 'warning'), false);
  }
  assert.equal(jobView({ ...base, kind: 'video' }).warning, base.warning);
  assert.equal(jobView({ ...base, kind: 'video', warning: undefined }).warning, null);
});
