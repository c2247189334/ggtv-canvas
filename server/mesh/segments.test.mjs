import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshSegments, MESH_SEGMENT_FRAMES, MESH_SEGMENT_OVERLAP } from './segments.mjs';

// 10-31 实测：372 帧整条显存爆、借内存超 10 分钟；切 0-131 / 116-255 / 240-371 约 7 分钟，接缝看不出跳。
test('372 帧切成实测过的三段：重叠 16 帧，各取中间、拼回正好 372 帧', () => {
  assert.equal(MESH_SEGMENT_FRAMES, 160); assert.equal(MESH_SEGMENT_OVERLAP, 16);
  assert.deepEqual(meshSegments(372), [
    { start: 0, end: 132, keepFrom: 0, keepTo: 124 },
    { start: 116, end: 256, keepFrom: 8, keepTo: 132 },
    { start: 240, end: 372, keepFrom: 8, keepTo: 132 },
  ]);
});

test('不超过 160 帧不切；30 秒 25fps 每段都不超过上限，拼回帧数不变且接缝相连', () => {
  assert.deepEqual(meshSegments(160), [{ start: 0, end: 160, keepFrom: 0, keepTo: 160 }]);
  assert.deepEqual(meshSegments(1), [{ start: 0, end: 1, keepFrom: 0, keepTo: 1 }]);
  for (const frames of [161, 165, 300, 372, 500, 750]) {
    const parts = meshSegments(frames);
    assert.ok(parts.length > 1);
    let next = 0;
    for (const part of parts) {
      assert.ok(part.end - part.start <= MESH_SEGMENT_FRAMES, `${frames} 帧有一段超长`);
      assert.equal(part.start + part.keepFrom, next); next = part.start + part.keepTo;
      assert.ok(part.keepTo <= part.end - part.start);
    }
    assert.equal(next, frames);
  }
});
