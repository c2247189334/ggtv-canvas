import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDepthQueue } from './queue.mjs';
import { createJobStore } from '../store/jobs.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

test('显卡顺序：深度和白模按交单先后，不打断在跑单，最多一单', async () => {
  const jobs = createJobStore(tempDir()), calls = [], releases = [];
  let active = 0, peak = 0;
  const execute = async job => {
    calls.push(job.id); active++; peak = Math.max(peak, active);
    await new Promise(resolve => releases.push(resolve)); active--;
    return { id: 'work' };
  };
  const queue = createDepthQueue({ jobs, media: { depth: execute, mesh: execute, stop() {} } });
  const running = queue.submit({ kind: 'depth' });
  const mesh = queue.submit({ kind: 'mesh' }), depth = queue.submit({ kind: 'depth' });
  assert.deepEqual(queue.queued().map(job => job.id), [mesh.id, depth.id]);
  for (let count = 1; count <= 3; count++) {
    await waitFor(() => calls.length === count); releases.shift()();
  }
  await waitFor(() => jobs.read(depth.id).status === 'succeeded');
  assert.deepEqual(calls, [running.id, mesh.id, depth.id]); assert.equal(peak, 1);
  queue.stop();
});

test('确认不了 ComfyUI 停没停（gpuUnsafe）：后面的单不再放，也不收新单，重启小服务才解除', async () => {
  const jobs = createJobStore(tempDir());
  let reject;
  const queue = createDepthQueue({ jobs, media: { mesh: () => new Promise((_, fail) => { reject = fail; }), stop() {} } });
  const running = queue.submit({ kind: 'mesh' }), pending = queue.submit({ kind: 'mesh' });
  await waitFor(() => reject);
  reject(Object.assign(Error('无法确认 ComfyUI 已停止'), { gpuUnsafe: true }));
  await waitFor(() => jobs.read(running.id).status === 'failed');
  queue.pump();
  assert.equal(jobs.read(pending.id).status, 'queued');
  assert.throws(() => queue.submit({ kind: 'depth' }), /无法确认ComfyUI已停止/);
  queue.stop();
});

test('删除画布：这张画布排着的撤掉、在跑的停掉，迟到交单拒收且不建孤单；其他画布照常', async () => {
  const jobs = createJobStore(tempDir());
  let started;
  const queue = createDepthQueue({ jobs, media: { depth: (_job, { signal }) => new Promise((_, fail) => {
    started = true; signal.addEventListener('abort', () => fail(Error('stopped')), { once: true });
  }), stop() {} } });
  const running = queue.submit({ kind: 'depth', canvasId: 'deleted' }), pending = queue.submit({ kind: 'mesh', canvasId: 'deleted' });
  await waitFor(() => started);
  queue.cancelCanvas('deleted');
  await waitFor(() => jobs.read(running.id).status === 'failed');
  assert.equal(jobs.read(running.id).errorCode, 'CANCELED');
  assert.deepEqual([jobs.read(pending.id).status, jobs.read(pending.id).errorCode, jobs.read(pending.id).yuan], ['failed', 'CANCELED', 0]);
  const count = jobs.list().length;
  assert.throws(() => queue.submit({ kind: 'depth', canvasId: 'deleted' }), /这张画布已经删除，不能交单/);
  assert.throws(() => queue.submit({ kind: 'mesh', canvasId: 'deleted' }), /这张画布已经删除，不能交单/);
  assert.equal(jobs.list().length, count, '拒绝前不创建孤单');
  queue.stop();
  assert.equal(queue.submit({ kind: 'depth', canvasId: 'other' }).status, 'queued');
  assert.equal(queue.submit({ kind: 'depth' }).status, 'queued');
});
