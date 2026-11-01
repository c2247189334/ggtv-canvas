import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseMp4 } from './mp4.mjs';
import * as mp4 from './mp4.mjs';
import { tempDir } from './testKit.mjs';

const box = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length + 8);
  head.write(type, 4);
  return Buffer.concat([head, data]);
};
function video({ version = 0, brand = 'isom', handler = 'vide', atEnd = false, matrix = [1, 0, 0, 1] } = {}) {
  const mvhd = Buffer.alloc(version ? 32 : 20);
  mvhd[0] = version;
  mvhd.writeUInt32BE(1000, version ? 20 : 12);
  if (version) mvhd.writeBigUInt64BE(2500n, 24);
  else mvhd.writeUInt32BE(2500, 16);
  const tkhd = Buffer.alloc(84);
  const [a, b, c, d] = matrix;
  tkhd.writeInt32BE(a * 65536, 40);
  tkhd.writeInt32BE(b * 65536, 44);
  tkhd.writeInt32BE(c * 65536, 52);
  tkhd.writeInt32BE(d * 65536, 56);
  tkhd.writeUInt32BE(640 * 65536, 76);
  tkhd.writeUInt32BE(480 * 65536, 80);
  const hdlr = Buffer.alloc(12);
  hdlr.write(handler, 8);
  const moov = box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', Buffer.concat([
    box('tkhd', tkhd), box('mdia', box('hdlr', hdlr))
  ]))]));
  return Buffer.concat([box('ftyp', Buffer.from(brand + '\0\0\0\0')), ...(atEnd ? [box('mdat', Buffer.alloc(5))] : []), moov]);
}

test('真实视频素材读出 320×180、2 秒', () => {
  assert.deepEqual(parseMp4(readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url))), {
    kind: 'video', contentType: 'video/mp4', ext: 'mp4', duration: 2, width: 320, height: 180, fps: 24, videoDuration: 2, hasAudio: false
  });
});

test('mvhd version 0/1、moov 在末尾和 MOV 主品牌', () => {
  for (const version of [0, 1]) {
    const parsed = parseMp4(video({ version, atEnd: true, brand: 'qt  ' }));
    assert.equal(parsed.duration, 2.5);
    assert.equal(parsed.width, 640);
    assert.equal(parsed.height, 480);
    assert.equal(parsed.contentType, 'video/quicktime');
    assert.equal(parsed.ext, 'mov');
  }
});

test('手机旋转标记转 90 / 270 度时宽高按显示方向对调，180 度不对调', () => {
  for (const matrix of [[0, 1, -1, 0], [0, -1, 1, 0]]) {
    const parsed = parseMp4(video({ matrix }));
    assert.deepEqual([parsed.width, parsed.height], [480, 640]);
  }
  const upsideDown = parseMp4(video({ matrix: [-1, 0, 0, -1] }));
  assert.deepEqual([upsideDown.width, upsideDown.height], [640, 480]);
});

test('不是视频轨、坏输入、截断和坏盒子不抛异常，返回 null', () => {
  assert.equal(parseMp4(video({ handler: 'soun' })), null);
  assert.equal(parseMp4(null), null);
  assert.equal(parseMp4(Buffer.from('not a video')), null);
  const good = video();
  for (let n = 0; n < good.length; n += 1) assert.equal(parseMp4(good.subarray(0, n)), null);
  const broken = video();
  broken.writeUInt32BE(7, 16);
  assert.equal(parseMp4(broken), null);
});

test('扩展ftyp头从真实payload读取qt品牌', () => {
  const original = video({ brand: 'qt  ' });
  const size = original.readUInt32BE(0);
  const header = Buffer.alloc(16);
  header.writeUInt32BE(1);
  header.write('ftyp', 4);
  header.writeBigUInt64BE(BigInt(size + 8), 8);
  const extended = Buffer.concat([header, original.subarray(8)]);
  assert.equal(parseMp4(extended).ext, 'mov');
  assert.equal(parseMp4(extended).contentType, 'video/quicktime');
});

test('音轨在视频轨后面也能识别；上传元数据不漏音轨', () => {
  const original = video();
  const audioHandler = Buffer.alloc(12); audioHandler.write('soun', 8);
  const audio = box('trak', box('mdia', box('hdlr', audioHandler)));
  const withAudio = Buffer.concat([original, audio]);
  const moovStart = original.indexOf(Buffer.from('moov')) - 4;
  withAudio.writeUInt32BE(original.readUInt32BE(moovStart) + audio.length, moovStart);
  assert.equal(parseMp4(withAudio).hasAudio, true);
  assert.equal(parseMp4(original).hasAudio, false);
});

test('从文件跳过mdat/free，只读头和末尾moov，支持size=0和64位盒子', () => {
  const original = video({ version: 1, brand: 'qt  ' });
  const ftypSize = original.readUInt32BE(0);
  for (const mode of ['normal', 'zero', 'large']) {
    const skip = box('mdat', Buffer.alloc(1024 * 1024));
    const movie = original.subarray(ftypSize);
    const header = Buffer.alloc(mode === 'large' ? 16 : 8);
    header.writeUInt32BE(mode === 'zero' ? 0 : mode === 'large' ? 1 : movie.length);
    header.write('moov', 4);
    if (mode === 'large') header.writeBigUInt64BE(BigInt(movie.length + 8), 8);
    const bytes = Buffer.concat([original.subarray(0, ftypSize), skip, header, movie.subarray(8)]);
    const file = join(tempDir(), 'v.mov'); writeFileSync(file, bytes);
    let total = 0;
    const parsed = mp4.readMp4File(file, { read: (...args) => { const n = readSync(...args); total += n; return n; } });
    assert.deepEqual(parsed, parseMp4(bytes));
    assert.equal(parsed.duration, 2.5);
    assert.ok(total < 4096, `实际读取了${total}字节`);
  }
});

test('文件读取：截断、坏largesize和尾部损坏返回null，不抛错', () => {
  const file = join(tempDir(), 'bad.mp4');
  const good = video();
  for (let n = 0; n < good.length; n++) {
    writeFileSync(file, good.subarray(0, n));
    assert.equal(mp4.readMp4File(file), null);
  }
  const tail = Buffer.alloc(16); tail.writeUInt32BE(1); tail.write('free', 4); tail.writeBigUInt64BE(2n ** 63n, 8);
  writeFileSync(file, Buffer.concat([good, tail]));
  assert.equal(mp4.readMp4File(file), null);
});
