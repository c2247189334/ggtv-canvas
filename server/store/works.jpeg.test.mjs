import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { createExecutor } from '../depth/executor.mjs';
import { createHandler, createRouter } from '../http.mjs';
import { assetRoutes } from '../routes/assets.mjs';
import { createWorkStore } from './works.mjs';
import { solidPng } from '../png.mjs';
import { tempDir } from '../testKit.mjs';

test('真实 JPEG 存 image.jpg、尺寸和 MIME 准确；重开仍能读取旧 PNG；HTTP MIME 与下载名正确', async () => {
  const root = tempDir(), executor = createExecutor();
  const source = join(root, 'source.jpg');
  try {
    await executor.run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=640x300', '-frames:v', '1', source]);
  } finally { executor.stop(); }
  let store = createWorkStore(root);
  const bytes = readFileSync(source), work = store.add(bytes, {});
  assert.match(store.path(work.id), /image\.jpg$/);
  assert.equal(work.width, 640); assert.equal(work.height, 300);
  assert.deepEqual(store.read(work.id).buffer, bytes);
  assert.equal(store.read(work.id).contentType, 'image/jpeg');
  const png = solidPng(4, 3, [1, 2, 3]), old = store.add(png, {});
  const { kind, ...legacy } = old;
  writeFileSync(join(dirname(store.path(old.id)), 'work.json'), JSON.stringify(legacy));
  store = createWorkStore(root);
  assert.equal(store.list().length, 2);
  assert.match(store.path(old.id), /image\.png$/);
  assert.deepEqual(store.read(old.id).buffer, png);
  assert.equal(store.read(old.id).contentType, 'image/png');
  assert.equal(store.metadata(old.id).kind, 'image');
  const router = createRouter(); assetRoutes(router, { works: store });
  const handler = createHandler({ router, allowedPorts: [], logError: (label, error) => { throw error; } });
  for (const [id, type, ext, expected] of [[work.id, 'image/jpeg', 'jpg', bytes], [old.id, 'image/png', 'png', png]]) {
    const chunks = [], res = new Writable({ write(chunk, encoding, done) { chunks.push(chunk); done(); } });
    let status, headers;
    res.writeHead = (code, fields) => { status = code; headers = fields; };
    await handler({ url: `/api/works/file?id=${id}&download=1`, method: 'GET', headers: { host: '127.0.0.1' } }, res);
    assert.equal(status, 200);
    assert.equal(headers['Content-Type'], type);
    assert.ok(headers['Content-Disposition'].endsWith(`.${ext}"`));
    assert.deepEqual(Buffer.concat(chunks), expected);
  }
});
