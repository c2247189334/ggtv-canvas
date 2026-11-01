import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createUploadStore, imageTypeOf } from './uploads.mjs';
import { newId } from './files.mjs';
import { solidPng } from '../png.mjs';
import { tempDir, waitFor } from '../testKit.mjs';

test('视频按真实类型保存，元数据、列出、读取和删除都支持 mp4/mov', () => {
  const store = createUploadStore(tempDir());
  for (const mov of [false, true]) {
    const bytes = readFileSync(new URL('../fixtures/fake-video.mp4', import.meta.url));
    if (mov) bytes.write('qt  ', 8);
    const saved = store.save(bytes);
    assert.equal(saved.kind, 'video');
    assert.equal(saved.duration, 2);
    assert.equal(saved.width, 320);
    assert.match(store.path(saved.id), mov ? /\.mov$/ : /\.mp4$/);
    assert.deepEqual(store.metadata(saved.id), {
      kind: 'video', contentType: mov ? 'video/quicktime' : 'video/mp4', duration: 2, width: 320, height: 180, fps:24,videoDuration:2,hasAudio:false, bytes: bytes.length
    });
    assert.deepEqual(store.read(saved.id).buffer, bytes);
    assert.ok(store.ids().includes(saved.id));
    assert.equal(store.remove(saved.id), true);
    assert.equal(store.metadata(saved.id), null);
  }
  assert.equal(store.save(Buffer.from('0000ftypqt  ')), null);
});

test('图片保存返回 kind，元数据保留原图片类型', () => {
  const store = createUploadStore(tempDir());
  const png = solidPng(4, 3, [0, 0, 0]);
  const saved = store.save(png);
  assert.equal(saved.kind, 'image');
  assert.deepEqual(store.metadata(saved.id), { kind: 'image', contentType: 'image/png', bytes: png.length });
});

test('存 PNG 能原样读回，类型对', () => {
  const store = createUploadStore(tempDir());
  const png = solidPng(4, 4, [9, 9, 9]);
  const saved = store.save(png);
  const back = store.read(saved.id);
  assert.deepEqual(back.buffer, png);
  assert.equal(back.contentType, 'image/png');
});

test('JPG、WebP 认得出', () => {
  assert.equal(imageTypeOf(Buffer.from([0xff, 0xd8, 0xff, 0xe0])).ext, 'jpg');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  assert.equal(imageTypeOf(webp).type, 'image/webp');
});

test('不是图片的拒收', () => {
  const store = createUploadStore(tempDir());
  assert.equal(store.save(Buffer.from('hello')), null);
});

test('乱传的编号、不存在的编号都读不到', () => {
  const store = createUploadStore(tempDir());
  assert.equal(store.path('../x'), null);
  assert.equal(store.read(newId()), null);
});

test('ids 列出所有传的图；remove 真删文件，再删回 false', () => {
  const store = createUploadStore(tempDir());
  assert.deepEqual(store.ids(), []);
  const a = store.save(solidPng(2, 2, [0, 0, 0])).id;
  const b = store.save(solidPng(2, 2, [1, 1, 1])).id;
  assert.deepEqual(store.ids().sort(), [a, b].sort());
  assert.equal(store.remove(a), true);
  assert.equal(store.path(a), null);
  assert.deepEqual(store.ids(), [b]);
  assert.equal(store.remove(a), false);
  assert.equal(store.remove('../x'), false);
});

test('边收边写part，完成前没有正式文件，成功才改名；read仍保留buffer', async () => {
  const root = tempDir(); const store = createUploadStore(root);
  const video = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
  const req = Readable.from((async function* () {
    yield video.subarray(0, 100);
    const names = readdirSync(join(root, '上传'));
    assert.equal(names.length, 1);
    assert.match(names[0], /\.part$/);
    await waitFor(() => statSync(join(root, '上传', names[0])).size === 100);
    assert.equal(statSync(join(root, '上传', names[0])).size, 100);
    yield video.subarray(100);
  })());
  const saved = await store.saveStream(req, { limit: video.length, message: 'limit' });
  assert.equal(saved.kind, 'video');
  assert.deepEqual(readdirSync(join(root, '上传')), [`${saved.id}.mp4`]);
  assert.equal(store.metadata(saved.id).bytes, video.length);
  assert.deepEqual(store.read(saved.id).buffer, video);
});

test('接收中断或校验失败都删除part，不留下正式文件', async () => {
  for (const mode of ['abort', 'validate']) {
    const root = tempDir(); const store = createUploadStore(root);
    const video = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
    const req = Readable.from((async function* () {
      yield video;
      if (mode === 'abort') throw new Error('接收中断');
    })());
    await assert.rejects(store.saveStream(req, { limit: video.length, message: 'limit',
      validate: () => { throw new Error('校验拒收'); } }), mode === 'abort' ? /接收中断/ : /校验拒收/);
    assert.deepEqual(readdirSync(join(root, '上传')), []);
  }
});

test('从文件保存视频：回包同save、保留源文件，拒收坏文件且不留下part或正式文件', () => {
  const root = tempDir(), store = createUploadStore(root);
  const input = join(root, 'input.mp4'), bytes = readFileSync(new URL('../fixtures/audio-video.mp4', import.meta.url));
  writeFileSync(input, bytes);
  const saved = store.saveFile(input);
  const other = store.save(bytes);
  const { id: _one, ...meta } = saved, { id: _two, ...expected } = other;
  assert.deepEqual(meta, expected);
  assert.deepEqual(store.read(saved.id).buffer, bytes);
  assert.equal(existsSync(input), true);
  assert.deepEqual(readdirSync(join(root, '上传')).sort(), [`${saved.id}.mp4`, `${other.id}.mp4`].sort());
  writeFileSync(input, 'broken');
  assert.equal(store.saveFile(input), null);
  assert.equal(store.ids().length, 2);
});
