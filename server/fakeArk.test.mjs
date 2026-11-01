import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeArk, fakeSize } from './fakeArk.mjs';
import { pngSize } from './png.mjs';

test('出一张假图，比例跟着尺寸走（长边 256）', async () => {
  const generate = createFakeArk({ delayMs: 0 });
  const r = await generate({ prompt: '猫', size: '1360x768' });
  assert.equal(r.ok, true);
  assert.deepEqual(pngSize(r.image), { width: 256, height: 145 });
});

test('没给尺寸就 256 见方', () => {
  assert.deepEqual(fakeSize(undefined), { width: 256, height: 256 });
});

test('提示词写「假失败」就假装被拒', async () => {
  const r = await createFakeArk({ delayMs: 0 })({ prompt: '假失败', size: '1024x1024' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('提示词写「假超时」就抛 EDIT_TIMEOUT', async () => {
  await assert.rejects(createFakeArk({ delayMs: 0 })({ prompt: '假超时' }), /EDIT_TIMEOUT/);
});

test('同一句提示词出两次颜色不一样（一眼看得出是两张）', async () => {
  const generate = createFakeArk({ delayMs: 0 });
  const a = await generate({ prompt: '猫', size: '1024x1024' });
  const b = await generate({ prompt: '猫', size: '1024x1024' });
  assert.notDeepEqual(a.image, b.image);
});
