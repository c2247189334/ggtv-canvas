import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempDir } from './testKit.mjs';
import { crc32, listZip, unzipTo, writeZip, zipDirectory } from '../scripts/zip.mjs';

function put(root, file, value = 'sample') {
  mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), value);
}

test('zip 写后读回：中文名、空文件、CRLF 和二进制都逐字节一致，条目名带前缀且用 UTF-8 标志', () => {
  const source = tempDir('zip-src-'), out = tempDir('zip-out-'), zip = join(tempDir('zip-'), 'pkg.zip');
  const random = randomBytes(70000), bat = Buffer.from('@echo off\r\necho GG TV\r\n', 'latin1');
  put(source, 'a.txt', 'hello'); put(source, 'empty.bin', ''); put(source, 'random.bin', random); put(source, '子目录/一键 启动.bat', bat);
  const result = zipDirectory(source, zip, 'pkg');
  assert.equal(result.entries, 4); assert.ok(result.bytes > 0 && result.bytes < random.length + 70000);
  assert.deepEqual(listZip(zip), ['pkg/a.txt', 'pkg/empty.bin', 'pkg/random.bin', 'pkg/子目录/一键 启动.bat']);
  const buffer = readFileSync(zip);
  assert.equal(buffer.readUInt32LE(0), 0x04034b50); assert.equal(buffer.readUInt16LE(6) & 0x0800, 0x0800, '文件名标成 UTF-8');
  unzipTo(zip, out);
  assert.equal(readFileSync(join(out, 'pkg/a.txt'), 'utf8'), 'hello');
  assert.equal(readFileSync(join(out, 'pkg/empty.bin')).length, 0);
  assert.ok(readFileSync(join(out, 'pkg/random.bin')).equals(random));
  assert.ok(readFileSync(join(out, 'pkg/子目录/一键 启动.bat')).equals(bat), 'CRLF 原样');
  assert.deepEqual(readdirSync(out), ['pkg']);
});

test('源文件夹里有链接就拒绝打包；条目路径越界、校验不符时拒绝解压且不写文件', () => {
  const source = tempDir('zip-link-');
  put(source, 'a.txt'); symlinkSync(tempDir(), join(source, 'linked'), 'junction');
  assert.throws(() => zipDirectory(source, join(tempDir(), 'x.zip')), /链接/);
  for (const name of ['../evil.txt', '/abs.txt', 'C:/x.txt', 'a\\b.txt', 'a/../b.txt', 'a//b.txt', './c.txt']) {
    const zip = join(tempDir('zip-bad-'), 'bad.zip'), out = tempDir('zip-bad-out-');
    writeZip([{ name: 'ok.txt', data: Buffer.from('ok') }, { name, data: Buffer.from('evil') }], zip);
    assert.throws(() => unzipTo(zip, out), /不安全/, name);
    assert.equal(existsSync(join(dirname(out), 'evil.txt')), false);
  }
  const zip = join(tempDir('zip-crc-'), 'crc.zip'), out = tempDir('zip-crc-out-');
  writeZip([{ name: 'a.txt', data: Buffer.from('hello world, hello world') }], zip);
  const buffer = readFileSync(zip);
  buffer.writeUInt32LE(crc32(Buffer.from('x')), buffer.length - 22 - 46 + 16); // 改掉中央目录里的校验和
  writeFileSync(zip, buffer);
  assert.throws(() => unzipTo(zip, out), /校验不符/);
  assert.equal(existsSync(join(out, 'a.txt')), false);
});
