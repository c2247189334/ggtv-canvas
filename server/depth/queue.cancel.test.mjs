import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDepthQueue, STOPPED_TEXT } from './queue.mjs';
import { createJobStore } from '../store/jobs.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

// 10-31 用户：删卡停不掉后台，不懂的人等不起也关不掉；要能停。
test('停止：排队的直接撤、不执行；在跑的发停止信号，标已停止并接着跑下一单；结束了的停不了', async () => {
  const jobs = createJobStore(tempDir()), calls = [];
  const media = { stop: () => {},
    mesh: (job, { signal }) => { calls.push(job.id); return new Promise((_, reject) => signal.addEventListener('abort',
      () => reject(Object.assign(Error('已停止'), { canceled: true })), { once: true })); },
    depth: async job => { calls.push(job.id); return { id: 'work' }; } };
  const queue = createDepthQueue({ jobs, media });
  const running = queue.submit({ kind: 'mesh' }), waiting = queue.submit({ kind: 'mesh' }), next = queue.submit({ resolution: '480p' });
  await waitFor(() => calls.length === 1);
  assert.equal(queue.cancel(waiting.id), 'stopped');
  assert.equal(jobs.read(waiting.id).status, 'failed'); assert.equal(jobs.read(waiting.id).errorCode, 'CANCELED');
  assert.equal(queue.cancel(running.id), 'stopping');
  await waitFor(() => jobs.read(next.id).status === 'succeeded');
  assert.deepEqual(calls, [running.id, next.id]);
  assert.equal(jobs.read(running.id).status, 'failed'); assert.equal(jobs.read(running.id).errorCode, 'CANCELED');
  assert.equal(jobs.read(running.id).error, STOPPED_TEXT); assert.equal(jobs.read(running.id).yuan, 0);
  assert.equal(queue.cancel(next.id), null); assert.equal(queue.cancel('missing'), null);
});

test('停止时 ComfyUI 没确认停下，照旧暂停整条显卡队列，不当成普通停止', async () => {
  const jobs = createJobStore(tempDir());
  const media = { stop: () => {}, depth: async () => ({ id: 'work' }),
    mesh: (_job, { signal }) => new Promise((_, reject) => signal.addEventListener('abort',
      () => reject(Object.assign(Error('无法确认 ComfyUI 已停止'), { gpuUnsafe: true })), { once: true })) };
  const queue = createDepthQueue({ jobs, media });
  const job = queue.submit({ kind: 'mesh' }); await waitFor(() => jobs.read(job.id).status === 'running');
  queue.cancel(job.id); await waitFor(() => jobs.read(job.id).status === 'failed');
  assert.equal(jobs.read(job.id).errorCode, 'MESH_FAILED');
  assert.throws(() => queue.submit({ resolution: '480p' }), /无法确认/);
});
