import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUploadName, createUploadRecords } from './uploadRecords.mjs';
import { tempDir } from '../testKit.mjs';

const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';

test('清单按最近一次上传倒序；touch 挪到最前；remove 只删这一条', () => {
  let tick = 0;
  const records = createUploadRecords(tempDir(), { now: () => new Date(Date.UTC(2026, 10, 12, 0, 0, tick++)) });
  assert.deepEqual(records.list(), []);
  records.add(A, { name: 'a.png', sha256: 'ha', kind: 'image', bytes: 3 });
  records.add(B, { name: 'b.mp4', sha256: 'hb', kind: 'video', bytes: 5, duration: 2 });
  assert.deepEqual(records.list().map(item => item.id), [B, A]);
  const touched = records.touch(A);
  assert.notEqual(touched.uploadedAt, touched.createdAt);
  assert.deepEqual(records.list().map(item => item.id), [A, B]);
  assert.equal(records.findByHash('hb').id, B);
  assert.equal(records.findByHash('nope'), null);
  assert.equal(records.remove(B), true);
  assert.equal(records.remove(B), false);
  assert.deepEqual(records.ids(), [A]);
});

test('文件名清洗：编码、路径、控制字符、长度、空名', () => {
  const backslash = String.fromCharCode(92);
  assert.equal(cleanUploadName(encodeURIComponent(['D:', '素材', '跳舞.mp4'].join(backslash))), '跳舞.mp4');
  assert.equal(cleanUploadName('%E0%A4%A'), '%E0%A4%A');
  assert.equal(cleanUploadName('a\u0000b.png'), 'ab.png');
  assert.equal(cleanUploadName('x'.repeat(250)).length, 200);
  assert.equal(cleanUploadName('  '), '未命名');
  assert.equal(cleanUploadName(undefined), '未命名');
});
