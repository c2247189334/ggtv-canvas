import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { pruneUploads, uploadIdsIn, pruneRewrites } from './cleanup.mjs';
import { mkdirSync } from 'node:fs';
import { createCanvasStore } from './store/canvases.mjs';
import { newId } from './store/files.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { solidPng } from './png.mjs';
import { tempDir } from './testKit.mjs';

const ID = '11111111-1111-4111-8111-111111111111';

test('启动删除所有改写中间目录，名字和卡片编号相同的也删', () => {
  const s = setup();
  for (const id of ['card-a', 'card-b', 'orphan']) mkdirSync(join(s.root, '改写', id), { recursive: true });
  for (const id of ['card-a', 'card-b']) {
    const doc = s.canvases.create(id);
    s.canvases.save(doc.id, { ...doc, baseVersion: doc.version, nodes: [{ id, type: 'video' }] });
  }
  assert.deepEqual(pruneRewrites({ ...s, dataRoot: s.root }), { removed: 3, skipped: false });
  assert.equal(existsSync(join(s.root, '改写', 'orphan')), false);
  for (const id of ['card-a', 'card-b']) assert.equal(existsSync(join(s.root, '改写', id)), false);
  mkdirSync(join(s.root, '改写', 'uncertain'));
  writeFileSync(join(s.root, '画布', `${newId()}.json`), '{bad');
  assert.deepEqual(pruneRewrites({ ...s, dataRoot: s.root }), { removed: 1, skipped: false });
  assert.equal(existsSync(join(s.root, '改写', 'uncertain')), false);
});

test('启动清理拒绝符号链接或junction根目录，不能删到配置数据目录外', () => {
  const fixture = tempDir(), dataRoot = join(fixture, 'data'), outside = join(fixture, 'outside');
  mkdirSync(dataRoot); mkdirSync(join(outside, 'protected'), { recursive: true });
  const sentinel = join(outside, 'protected', 'keep.txt'); writeFileSync(sentinel, 'keep');
  symlinkSync(outside, join(dataRoot, '改写'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.deepEqual(pruneRewrites({ dataRoot }), { removed: 0, skipped: true });
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep');
});

test('改写根路径是普通文件时跳过，不因readdir失败导致启动中断', () => {
  const dataRoot = tempDir(); writeFileSync(join(dataRoot, '改写'), 'not a directory');
  assert.deepEqual(pruneRewrites({ dataRoot }), { removed: 0, skipped: true });
});

function setup() {
  const root = tempDir();
  return { root, canvases: createCanvasStore(root), uploads: createUploadStore(root), jobs: createJobStore(root) };
}

const png = () => solidPng(2, 2, [0, 0, 0]);
const card = (uploadId) => ({ id: 'card-1', data: { results: [{ type: 'upload', id: uploadId }] } });

test('视频素材：画布、排队和生成中的保留，其余删除', () => {
  const s = setup();
  const bytes = readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url));
  const ids = Array.from({ length: 4 }, () => s.uploads.save(bytes).id);
  const doc = s.canvases.create('c');
  s.canvases.save(doc.id, { ...doc, baseVersion: doc.version, nodes: [card(ids[0])] });
  s.jobs.create({ kind: 'video', refs: [{ type: 'upload', id: ids[1] }] });
  const running = s.jobs.create({ kind: 'video', refs: [{ type: 'upload', id: ids[2] }] });
  s.jobs.patch(running.id, { status: 'running', phase: 'waiting' });
  assert.deepEqual(pruneUploads(s), { removed: 1, skipped: false });
  for (const id of ids.slice(0, 3)) assert.ok(s.uploads.path(id));
  assert.equal(s.uploads.path(ids[3]), null);
});

test('uploadIdsIn 在任意深度找 { type: upload, id }；作品、乱写的编号不算', () => {
  const found = uploadIdsIn({
    nodes: [{ data: { results: [{ type: 'upload', id: ID }, { type: 'work', id: newId() }] } }, { type: 'upload', id: '../x' }]
  });
  assert.deepEqual([...found], [ID]);
});

test('画布上在用的、没跑完的单子要用的留着；其余真删', () => {
  const s = setup();
  const onCanvas = s.uploads.save(png()).id;
  const forQueued = s.uploads.save(png()).id;
  const forFinished = s.uploads.save(png()).id;
  const orphan = s.uploads.save(png()).id;
  const doc = s.canvases.create('c');
  s.canvases.save(doc.id, { ...doc, baseVersion: doc.version, nodes: [card(onCanvas)] });
  s.jobs.create({ refs: [{ type: 'upload', id: forQueued }] });
  const done = s.jobs.create({ refs: [{ type: 'upload', id: forFinished }] });
  s.jobs.patch(done.id, { status: 'succeeded' });
  assert.deepEqual(pruneUploads(s), { removed: 2, skipped: false });
  assert.ok(s.uploads.path(onCanvas));
  assert.ok(s.uploads.path(forQueued));
  assert.equal(s.uploads.path(forFinished), null);
  assert.equal(s.uploads.path(orphan), null);
});

test('画布删掉以后，它用的传的图下次收拾时删掉', () => {
  const s = setup();
  const up = s.uploads.save(png()).id;
  const doc = s.canvases.create('c');
  s.canvases.save(doc.id, { ...doc, baseVersion: doc.version, nodes: [card(up)] });
  assert.deepEqual(pruneUploads(s), { removed: 0, skipped: false });
  s.canvases.remove(doc.id);
  assert.deepEqual(pruneUploads(s), { removed: 1, skipped: false });
  assert.equal(s.uploads.path(up), null);
});

test('有画布存档读不出来：一张都不删（宁可留着，也别删掉可能还在用的图）', () => {
  const s = setup();
  const orphan = s.uploads.save(png()).id;
  s.canvases.create('c');
  writeFileSync(join(s.root, '画布', `${newId()}.json`), '{坏');
  assert.deepEqual(pruneUploads(s), { removed: 0, skipped: true });
  assert.ok(s.uploads.path(orphan));
});

test('启动清理崩溃遗留part，即使画布读坏也清临时文件、保留正式文件', () => {
  for (const corrupt of [false, true]) {
    const s = setup();
    const saved = s.uploads.save(png());
    const doc = s.canvases.create('c');
    s.canvases.save(doc.id, { ...doc, baseVersion: doc.version, nodes: [card(saved.id)] });
    const part = join(s.root, '上传', `${newId()}.part`);
    writeFileSync(part, 'unfinished');
    if (corrupt) writeFileSync(join(s.root, '画布', `${doc.id}.json`), '{bad');
    pruneUploads(s);
    assert.equal(existsSync(part), false);
    assert.ok(s.uploads.path(saved.id));
  }
});
