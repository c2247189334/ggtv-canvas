import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../store/jobs.mjs';
import { createDepthQueue } from './queue.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

// 11-15 本地跑（本机 H3）挪去本地版：任务记录里留下的旧 h3 单不再归显卡队管——重启收尾、排第几、交下一单都不碰它，也不报错。
test('旧任务记录里的 h3 单：重启不当成在跑的显卡单，不排位、不执行；深度单照常跑', async () => {
  const jobs = createJobStore(tempDir()), calls = [];
  const running = jobs.create({ kind: 'h3', canvasId: 'c', cardId: 'v1', count: 1 });
  jobs.patch(running.id, { status: 'running' });
  const queuedH3 = jobs.create({ kind: 'h3', canvasId: 'c', cardId: 'v2', count: 1 });
  const queue = createDepthQueue({ jobs, media: { depth: async job => { calls.push(job.id); return { id: 'work' }; }, stop() {} } });
  assert.equal(queue.recover(), 0);
  assert.equal(jobs.read(running.id).status, 'running');
  assert.deepEqual(queue.queued(), []);
  const depth = queue.submit({ kind: 'depth', canvasId: 'c', cardId: 'd' });
  await waitFor(() => jobs.read(depth.id).status === 'succeeded');
  assert.deepEqual(calls, [depth.id]);
  assert.equal(jobs.read(queuedH3.id).status, 'queued');
  queue.stop();
});
