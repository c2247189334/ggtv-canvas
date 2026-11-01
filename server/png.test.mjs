import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pngSize, solidPng } from './png.mjs';

test('solidPng 造出来的图读得出宽高', () => {
  assert.deepEqual(pngSize(solidPng(3, 2, [1, 2, 3])), { width: 3, height: 2 });
});

test('不是 PNG 返回 null', () => {
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null);
  assert.equal(pngSize(null), null);
});
