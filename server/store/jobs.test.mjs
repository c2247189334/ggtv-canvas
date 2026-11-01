import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from './jobs.mjs';
import { tempDir } from '../testKit.mjs';

function clock() {
  let t = Date.parse('2026-10-20T00:00:00Z');
  return () => new Date((t += 1000));
}

test('新建一单：排队中、没有作品、没有错误，能读回', () => {
  const store = createJobStore(tempDir(), { now: clock() });
  const job = store.create({ model: 'm', count: 2 });
  assert.equal(job.status, 'queued');
  assert.deepEqual(job.works, []);
  assert.equal(job.error, null);
  assert.equal(job.count, 2);
  assert.deepEqual(store.read(job.id), job);
});

test('patch 只改给的字段；单子不在返回 null', () => {
  const store = createJobStore(tempDir(), { now: clock() });
  const job = store.create({ model: 'm' });
  assert.equal(store.patch(job.id, { status: 'running' }).model, 'm');
  assert.equal(store.read(job.id).status, 'running');
  assert.equal(store.patch('33333333-3333-4333-8333-333333333333', { status: 'x' }), null);
});

test('清单先来的在前；乱传的编号读不到', () => {
  const store = createJobStore(tempDir(), { now: clock() });
  const a = store.create({});
  const b = store.create({});
  assert.deepEqual(store.list().map((j) => j.id), [a.id, b.id]);
  assert.equal(store.read('../x'), null);
});
