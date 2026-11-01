import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDepthQueue } from './queue.mjs';
import { createQueue } from '../queue.mjs';
import { createJobStore } from '../store/jobs.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

test('白模和深度共用单并发：先落盘、失败不重跑，图片队列不碰白模', async () => {
  const jobs = createJobStore(tempDir()), releases = [], calls = [];
  let active = 0, peak = 0, stops = 0;
  const execute = async job => {
    assert.equal(jobs.read(job.id).status, 'running');
    active++; peak = Math.max(peak, active); calls.push(job.kind);
    await new Promise(resolve => releases.push(resolve)); active--;
    if (job.kind === 'mesh') throw Error('白模失败原话');
    return { id: 'work' };
  };
  const queue = createDepthQueue({ jobs, media: { depth: execute, mesh: execute, stop: () => { stops++; } } });
  const mesh = queue.submit({ kind: 'mesh' }), depth = queue.submit({ resolution: '480p' });
  assert.equal(jobs.read(mesh.id).kind, 'mesh');
  assert.equal(jobs.read(depth.id).status, 'queued');
  await waitFor(() => calls.length === 1); releases.shift()();
  await waitFor(() => calls.length === 2); releases.shift()();
  await waitFor(() => jobs.read(depth.id).status === 'succeeded');
  assert.deepEqual(calls, ['mesh', 'depth']); assert.equal(peak, 1);
  assert.equal(jobs.read(mesh.id).status, 'failed'); assert.equal(jobs.read(mesh.id).errorCode, 'MESH_FAILED');
  assert.equal(jobs.read(mesh.id).error, '白模失败原话');
  const interrupted = jobs.create({ kind: 'mesh' }); jobs.patch(interrupted.id, { status: 'running' });
  assert.equal(queue.recover(), 1); assert.equal(jobs.read(interrupted.id).errorCode, 'SERVER_RESTARTED');
  const pending = jobs.create({ kind: 'mesh' });
  const images = createQueue({ jobs }); assert.equal(images.recover(), 0); images.pump();
  assert.equal(jobs.read(pending.id).status, 'queued');
  queue.stop(); assert.equal(stops, 1);
});

test('ComfyUI未确认停止就暂停共享显卡队列，拒绝新单且不偷偷执行已排队深度', async () => {
  const jobs = createJobStore(tempDir()), calls = [];
  const media = { mesh: async () => { calls.push('mesh'); throw Object.assign(Error('无法确认ComfyUI已停止'), { gpuUnsafe: true }); },
    depth: async () => { calls.push('depth'); return { id: 'work' }; }, stop: () => {} };
  const queue = createDepthQueue({ jobs, media });
  const first = queue.submit({ kind: 'mesh' }), pending = queue.submit({ resolution: '480p' });
  await waitFor(() => jobs.read(first.id).status === 'failed');
  queue.pump(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['mesh']); assert.equal(jobs.read(pending.id).status, 'queued');
  assert.throws(() => queue.submit({ kind: 'mesh' }), /无法确认ComfyUI已停止，请先确认停止并重启小服务/);
  assert.throws(() => queue.submit({ resolution: '480p' }), /无法确认ComfyUI已停止，请先确认停止并重启小服务/);
  assert.equal(jobs.list().length, 2); queue.stop();
});
