import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { createCharacterStore } from './store/characters.mjs';
import { createCanvasStore } from './store/canvases.mjs';
import { createUploadStore } from './store/uploads.mjs';
import { createJobStore } from './store/jobs.mjs';
import { pruneUploads } from './cleanup.mjs';
import { solidPng } from './png.mjs';
import { tempDir } from './testKit.mjs';

function setup() {
  const root = tempDir('characters-cleanup-');
  return { root, characters: createCharacterStore(root), canvases: createCanvasStore(root), uploads: createUploadStore(root), jobs: createJobStore(root) };
}

test('仅人物引用的上传图保留，人物删除后可清理孤立图', () => {
  const s = setup(), png = solidPng(4, 4, [1, 2, 3]);
  const kept = s.uploads.save(png), orphan = s.uploads.save(png);
  const c = s.characters.create({ name: '人物', description: '', images: [{ ref: { type: 'upload', id: kept.id }, label: '图 1' }], status: 'ready' });
  assert.deepEqual(pruneUploads(s), { removed: 1, skipped: false });
  assert.ok(s.uploads.path(kept.id)); assert.equal(s.uploads.path(orphan.id), null);
  s.characters.remove(c.id);
  assert.deepEqual(pruneUploads(s), { removed: 1, skipped: false }); assert.equal(s.uploads.path(kept.id), null);
});

test('坏人物存档令上传清理跳过，原上传文件保留', () => {
  const s = setup(), upload = s.uploads.save(solidPng(4, 4, [1, 2, 3]));
  const c = s.characters.create({ name: '坏档', description: '', images: [], status: 'ready' });
  writeFileSync(join(s.root, '人物', c.id, 'character.json'), '{bad');
  assert.deepEqual(pruneUploads(s), { removed: 0, skipped: true }); assert.ok(s.uploads.path(upload.id));
});
