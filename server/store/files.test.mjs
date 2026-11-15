import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
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

test('writeJsonAtomic 改名时文件被别的程序占着（EPERM / EBUSY）：等一下重试，占用松开就写成', () => {
  const file = join(tempDir(), 'busy.json');
  const waits = [];
  let attempts = 0;
  const rename = (from, to) => {
    attempts += 1;
    if (attempts <= 2) throw Object.assign(Error('busy'), { code: attempts === 1 ? 'EPERM' : 'EBUSY' });
    renameSync(from, to);
  };
  writeJsonAtomic(file, { x: 2 }, { rename, wait: ms => waits.push(ms) });
  assert.deepEqual(readJsonSafe(file), { x: 2 });
  assert.equal(attempts, 3);
  assert.equal(waits.length, 2);
});

test('writeJsonAtomic 一直被占着：试够次数才报错，临时文件不留；别的错（盘满）不重试', () => {
  const dir = tempDir();
  const waits = [];
  let attempts = 0;
  const always = () => { attempts += 1; throw Object.assign(Error('busy'), { code: 'EPERM' }); };
  assert.throws(() => writeJsonAtomic(join(dir, 'a.json'), { x: 1 }, { rename: always, wait: ms => waits.push(ms) }), /busy/);
  assert.equal(attempts, 5);
  assert.equal(waits.length, 4);
  attempts = 0;
  const full = () => { attempts += 1; throw Object.assign(Error('full'), { code: 'ENOSPC' }); };
  assert.throws(() => writeJsonAtomic(join(dir, 'b.json'), { x: 1 }, { rename: full, wait: ms => waits.push(ms) }), /full/);
  assert.equal(attempts, 1);
  assert.equal(waits.length, 4);
  assert.deepEqual(readdirSync(dir), []);
});
