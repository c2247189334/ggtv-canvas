import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSpendLog, dayKey } from './spend.mjs';
import { tempDir } from '../testKit.mjs';

test('今天的加起来，昨天的不算', () => {
  const log = createSpendLog(tempDir());
  const today = new Date(2026, 9, 20, 10);
  log.add({ yuan: 0.12, model: 'm', jobId: 'a', at: today });
  log.add({ yuan: 0.22, model: 'm', jobId: 'b', at: today });
  log.add({ yuan: 5, model: 'm', jobId: 'c', at: new Date(2026, 9, 19, 23) });
  assert.equal(log.totalOn(today), 0.34);
});

test('还没出过图是 0', () => {
  assert.equal(createSpendLog(tempDir()).totalOn(new Date()), 0);
});

test('坏行跳过，不影响别的', () => {
  const root = tempDir();
  const log = createSpendLog(root);
  const now = new Date(2026, 9, 20, 10);
  log.add({ yuan: 0.12, model: 'm', jobId: 'a', at: now });
  appendFileSync(join(root, '花费.jsonl'), '这不是 JSON\n');
  assert.equal(log.totalOn(now), 0.12);
});

test('dayKey 用本地时间', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
