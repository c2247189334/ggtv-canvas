import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../testKit.mjs';
import { Readable, Writable } from 'node:stream';
import { createApp } from '../app.mjs';
import { createCanvasStore } from '../store/canvases.mjs';

function setup() {
  const root = tempDir('canvas-version-');
  const app = createApp({ dataRoot: root, distDir: join(root, 'empty-page'), port: 5398, fake: true,
    readEnv: () => ({}), generate: async () => { throw Error('不得生成'); }, log: () => {}, logError: () => {} });
  return { root, app, call: async (method, url, data) => {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    Object.assign(req, { method, url, headers: { host: '127.0.0.1:5398', 'content-type': 'application/json' } });
    let status; const chunks = [];
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.writeHead = value => { status = value; }; await app.handler(req, res);
    return { status, json: JSON.parse(Buffer.concat(chunks).toString()) };
  } };
}

test('同一版本双标签保存：第一份成功加版本，第二份409且完整保留第一份', async () => {
  const { call } = setup(), created = (await call('POST', '/api/canvases', { name: '版本验证' })).json;
  assert.equal(created.version, 0);
  const path = `/api/canvas?id=${created.id}`;
  const a = { ...created, baseVersion: 0, nodes: [{ id: 'first' }], edges: [{ id: 'edge-first' }] };
  const b = { ...created, baseVersion: 0, nodes: [{ id: 'second' }], edges: [] };
  const first = await call('PUT', path, a), second = await call('PUT', path, b);
  assert.equal(first.status, 200); assert.equal(first.json.version, 1);
  assert.equal(second.status, 409); assert.match(second.json.error, /别的标签页.*刷新/);
  const saved = (await call('GET', path)).json;
  assert.deepEqual(saved.nodes, a.nodes); assert.deepEqual(saved.edges, a.edges); assert.equal(saved.version, 1);
  assert.equal((await call('PUT', path, { ...saved, baseVersion: 1, name: '第二次保存' })).json.version, 2);
});

test('历史无版本存档按0读且可用baseVersion0保存，缺失或伪造版本不能绕过冲突', async () => {
  const { root, call } = setup(), id = '11111111-1111-4111-8111-111111111111';
  mkdirSync(join(root, '画布'), { recursive: true });
  writeFileSync(join(root, '画布', `${id}.json`), JSON.stringify({ id, name: '旧档', nodes: [], edges: [], createdAt: 'old' }));
  const store = createCanvasStore(root); assert.equal(store.read(id).version, 0);
  const path = `/api/canvas?id=${id}`, old = (await call('GET', path)).json;
  assert.equal(old.version, 0);
  assert.equal((await call('PUT', path, { ...old, baseVersion: 0 })).status, 200);
  for (const baseVersion of [undefined, -1, '1', 1.5, 0]) {
    assert.equal((await call('PUT', path, { ...old, baseVersion })).status, 409);
  }
  assert.equal((await call('GET', path)).json.version, 1);
});
