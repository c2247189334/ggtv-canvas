import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from './imageSize.mjs';
import { solidPng } from './png.mjs';

// SOI、APP1、SOF（3 个分量）、EOI，专门覆盖段跳转，不用于解码。
const jpeg = marker => Buffer.from([
  255, 216, 255, 225, 0, 4, 1, 2, 255, marker, 0, 17,
  8, 1, 44, 2, 128, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217
]);

test('PNG 和各类 JPEG SOF 段读真实宽高，跳过 APP 段', () => {
  assert.deepEqual(imageSize(solidPng(4, 3, [0, 0, 0])), { width: 4, height: 3 });
  for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]) {
    assert.deepEqual(imageSize(jpeg(marker)), { width: 640, height: 300 });
  }
});

test('截断、非法段长、没有 SOF 和零尺寸都返回 null，不越界读取', () => {
  const good = jpeg(0xc2);
  for (let length = 0; length < 27; length++) assert.equal(imageSize(good.subarray(0, length)), null);
  for (const length of [0, 1, 65535]) {
    const bad = Buffer.from(good); bad.writeUInt16BE(length, 4);
    assert.equal(imageSize(bad), null);
  }
  const zero = Buffer.from(good); zero.writeUInt16BE(0, 13);
  assert.equal(imageSize(zero), null);
  assert.equal(imageSize(jpeg(0xc4)), null);
  assert.equal(imageSize(null), null);
});
