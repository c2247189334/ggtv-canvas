import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createWorkStore } from './works.mjs';
import { solidPng } from '../png.mjs';
import { tempDir } from '../testKit.mjs';

function clock() {
  let t = Date.parse('2026-10-20T00:00:00Z');
  return () => new Date((t += 1000));
}

const meta = { jobId: 'j', canvasId: 'c', prompt: '一只猫', model: 'm', yuan: 0.12, refs: [] };

test('作品参考种类以实际文件定，不能把视频伪装为出图参考', () => {
  const store = createWorkStore(tempDir());
  const work = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  const bytes = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
  writeFileSync(store.path(work.id), bytes);
  assert.equal(store.metadata(work.id).kind, 'video');
  writeFileSync(store.path(work.id), 'not media');
  assert.equal(store.metadata(work.id), null);
});

test('视频作品保存元数据、列出、读回和删除；不信调用方传入的媒体尺寸', () => {
  const store = createWorkStore(tempDir());
  const bytes = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
  const work = store.addVideo(bytes, { ...meta, duration: 9, width: 9, resolution: '480p', ratio: '16:9', mode: 'reference', taskId: 'task-1' });
  assert.equal(work.kind, 'video');
  assert.equal(work.duration, 2);
  assert.equal(work.width, 320);
  assert.equal(work.height, 180);
  assert.equal(work.taskId, 'task-1');
  assert.equal(work.resolution, '480p');
  assert.equal(work.ratio, '16:9');
  assert.equal(work.mode, 'reference');
  assert.equal(work.yuan, 0.12);
  assert.match(store.path(work.id), /video\.mp4$/);
  assert.deepEqual(store.metadata(work.id), { kind: 'video', contentType: 'video/mp4', duration: 2, width: 320, height: 180, fps:24,videoDuration:2,hasAudio:false, bytes: bytes.length });
  assert.deepEqual(store.read(work.id).buffer, bytes);
  assert.equal(store.list()[0].id, work.id);
  assert.equal(store.remove(work.id), true);
  assert.equal(store.read(work.id), null);
  assert.equal(store.addVideo(Buffer.from('bad'), meta), null);
});

test('没有 kind 的老作品照旧读和列出', () => {
  const store = createWorkStore(tempDir());
  const work = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  const { kind, ...legacy } = work;
  writeFileSync(join(dirname(store.path(work.id)), 'work.json'), JSON.stringify(legacy));
  assert.equal(store.list().length, 1);
  assert.equal(store.read(work.id).contentType, 'image/png');
  assert.equal(store.metadata(work.id).kind, 'image');
});

test('存一张作品：图和说明都在，尺寸从 PNG 里读', () => {
  const store = createWorkStore(tempDir(), { now: clock() });
  const png = solidPng(4, 3, [1, 2, 3]);
  const work = store.add(png, meta);
  assert.equal(work.kind, 'image');
  assert.equal(work.prompt, '一只猫');
  assert.equal(work.width, 4);
  assert.equal(work.height, 3);
  assert.deepEqual(store.read(work.id).buffer, png);
});

test('清单新的在前', () => {
  const store = createWorkStore(tempDir(), { now: clock() });
  const a = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  const b = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  assert.deepEqual(store.list().map((w) => w.id), [b.id, a.id]);
});

test('删掉以后读不到、清单里也没了；再删回 false', () => {
  const store = createWorkStore(tempDir(), { now: clock() });
  const work = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  assert.equal(store.remove(work.id), true);
  assert.equal(store.read(work.id), null);
  assert.deepEqual(store.list(), []);
  assert.equal(store.remove(work.id), false);
});

test('图片文件没了的作品不进清单', () => {
  const store = createWorkStore(tempDir(), { now: clock() });
  const work = store.add(solidPng(2, 2, [0, 0, 0]), meta);
  rmSync(store.path(work.id));
  assert.deepEqual(store.list(), []);
});
