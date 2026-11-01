import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanName, createCanvasStore } from './canvases.mjs';
import { newId } from './files.mjs';
import { tempDir } from '../testKit.mjs';

function clock() {
  let t = Date.parse('2026-10-20T00:00:00Z');
  return () => new Date((t += 1000));
}

test('新建一张画布：没有卡片、不存编号计数器（页面每次打开从 1 数），能读回来', () => {
  const store = createCanvasStore(tempDir(), { now: clock() });
  const doc = store.create('画布 1');
  assert.equal(doc.name, '画布 1');
  assert.deepEqual(doc.nodes, []);
  assert.deepEqual(doc.edges, []);
  assert.equal('nextNumber' in doc, false);
  assert.deepEqual(store.read(doc.id), doc);
});

test('清单按最近改过的排前面，只给 id / 名字 / 时间', () => {
  const store = createCanvasStore(tempDir(), { now: clock() });
  const a = store.create('A');
  const b = store.create('B');
  store.save(a.id, { ...a, baseVersion: a.version, name: 'A2' });
  assert.deepEqual(store.list().map((c) => c.name), ['A2', 'B']);
  assert.deepEqual(Object.keys(store.list()[0]).sort(), ['id', 'name', 'updatedAt']);
  assert.ok(b.id);
});

test('存整份：名字、卡片、连线都换，createdAt 不变；旧的编号计数器不再存', () => {
  const store = createCanvasStore(tempDir(), { now: clock() });
  const doc = store.create('A');
  const saved = store.save(doc.id, { baseVersion: doc.version, name: 'B', nextNumber: 3, nextNumbers: { image: 2 }, nodes: [{ id: 'card-1' }], edges: [{ id: 'e' }] });
  assert.equal(saved.name, 'B');
  assert.equal('nextNumber' in saved, false);
  assert.equal('nextNumbers' in saved, false);
  assert.equal(saved.nodes.length, 1);
  assert.equal(saved.edges.length, 1);
  assert.equal(saved.createdAt, doc.createdAt);
  assert.notEqual(saved.updatedAt, doc.updatedAt);
});

test('画布删了以后再存，不会凭空建出来', () => {
  const store = createCanvasStore(tempDir(), { now: clock() });
  const doc = store.create('A');
  assert.equal(store.remove(doc.id), true);
  assert.equal(store.save(doc.id, doc), null);
  assert.equal(store.read(doc.id), null);
  assert.equal(store.remove(doc.id), false);
});

test('名字：去首尾空白、截到 40 字，空的叫「未命名画布」', () => {
  assert.equal(cleanName('  x  '), 'x');
  assert.equal(cleanName(''), '未命名画布');
  assert.equal(cleanName(undefined), '未命名画布');
  assert.equal(cleanName('字'.repeat(50)).length, 40);
});

test('乱传的编号读不到', () => {
  const store = createCanvasStore(tempDir());
  assert.equal(store.read('../../x'), null);
});

test('docs 给所有画布的完整存档；有一份读坏了就返回 null', () => {
  const root = tempDir();
  const store = createCanvasStore(root, { now: clock() });
  assert.deepEqual(store.docs(), []);
  const a = store.create('A');
  const b = store.create('B');
  assert.deepEqual(store.docs().map((d) => d.id).sort(), [a.id, b.id].sort());
  writeFileSync(join(root, '画布', `${newId()}.json`), '{坏');
  assert.equal(store.docs(), null);
});
