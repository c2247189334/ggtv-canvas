import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImageModel, priceOf } from './pricing.mjs';

test('Flash 0.12、Lite 0.22，认不出的按最贵的算', () => {
  assert.equal(priceOf('doubao-seedream-5-0-flash-260915'), 0.12);
  assert.equal(priceOf('doubao-seedream-5-0-lite-260128'), 0.22);
  assert.equal(priceOf('x'), 0.22);
});

test('只认表里两款，原型链上的名字不算', () => {
  assert.equal(isImageModel('doubao-seedream-5-0-flash-260915'), true);
  assert.equal(isImageModel('toString'), false);
});
