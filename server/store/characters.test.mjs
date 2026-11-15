import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCharacterStore } from './characters.mjs';
import { tempDir } from '../testKit.mjs';

test('人物原子存盘，新的在前，重开读取、改名描述和删除仅影响人物记录', () => {
  const root = tempDir('character-store-'); let tick = 0;
  const store = createCharacterStore(root, { now: () => new Date(++tick * 1000) });
  const first = store.create({ name: '甲', description: '', images: [], status: 'generating' });
  const second = store.create({ name: '乙', description: '描述', images: [], status: 'failed', error: '失败原话' });
  assert.deepEqual(store.list().map(c => c.id), [second.id, first.id]);
  assert.deepEqual(readdirSync(join(root, '人物', first.id)), ['character.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '人物', first.id, 'character.json'), 'utf8')), first);
  const reopened = createCharacterStore(root);
  const changed = reopened.patch(first.id, { name: '改名', description: '新描述' });
  assert.equal(changed.name, '改名'); assert.equal(changed.description, '新描述');
  assert.equal(changed.createdAt, first.createdAt); assert.notEqual(changed.updatedAt, first.updatedAt);
  assert.equal(reopened.remove(first.id), true); assert.equal(reopened.read(first.id), null);
  assert.equal(reopened.read(second.id).error, '失败原话');
  assert.equal(reopened.remove('../bad'), false); assert.equal(reopened.patch('../bad', {}), null);
});

test('坏人物存档跳过列表，清理用docs报告不完整以保留上传素材', () => {
  const root = tempDir('character-corrupt-'), store = createCharacterStore(root);
  const good = store.create({ name: '甲', description: '', images: [], status: 'ready' });
  const bad = store.create({ name: '乙', description: '', images: [], status: 'ready' });
  writeFileSync(join(root, '人物', bad.id, 'character.json'), '{bad');
  assert.deepEqual(store.list().map(c => c.id), [good.id]);
  assert.equal(store.docs(), null); assert.equal(store.read('../outside'), null);
});
