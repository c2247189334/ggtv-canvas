import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId, readJsonSafe, writeJsonAtomic } from './files.mjs';
import { tempDir } from '../testKit.mjs';

test('isId 只认我们自己生成的 uuid 形状', () => {
  assert.equal(isId(newId()), true);
  assert.equal(isId('../x'), false);
  assert.equal(isId('ABCDEFAB-1111-4111-8111-111111111111'), false);
  assert.equal(isId(42), false);
});

test('writeJsonAtomic 写完能读回，目录不存在会自己建', () => {
  const file = join(tempDir(), 'a', 'b.json');
  writeJsonAtomic(file, { x: 1 });
  assert.deepEqual(readJsonSafe(file), { x: 1 });
});

test('writeJsonAtomic 改名失败：照样报错，临时文件不留在硬盘上', () => {
  const dir = tempDir();
  const file = join(dir, 'x.json');
  mkdirSync(file); // 目标位置被一个文件夹占着，改名必然失败
  assert.throws(() => writeJsonAtomic(file, { x: 1 }));
  assert.deepEqual(readdirSync(dir), ['x.json']);
});

test('readJsonSafe：读不到或读坏了返回 null', () => {
  const dir = tempDir();
  assert.equal(readJsonSafe(join(dir, 'nope.json')), null);
  writeFileSync(join(dir, 'bad.json'), '{坏');
  assert.equal(readJsonSafe(join(dir, 'bad.json')), null);
});
