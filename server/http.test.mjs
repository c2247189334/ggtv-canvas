import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { HttpError, createHandler, createRouter, readJson, safeJoin, sendJson, sendFile } from './http.mjs';
import { call, listen, tempDir } from './testKit.mjs';

async function boot(dist = tempDir()) {
  const errors = [];
  const router = createRouter();
  router.add('GET', '/api/ping', async ({ res, query }) => sendJson(res, 200, { pong: query.get('x') }));
  router.add('POST', '/api/echo', async ({ req, res }) => sendJson(res, 200, await readJson(req)));
  router.add('GET', '/api/teapot', async () => {
    throw new HttpError(418, '我是茶壶');
  });
  router.add('GET', '/api/boom', async () => {
    throw new Error('C:\\secret\\path 炸了');
  });
  const handler = createHandler({ router, distDir: dist, allowedPorts: [5290], logError: (tag, err) => errors.push({ tag, err }) });
  return { ...(await listen(handler)), errors };
}

const json = { 'Content-Type': 'application/json' };

test('静态文件流被中断时由HTTP统一接住，不产生未处理拒绝', async () => {
  const dist = tempDir();
  writeFileSync(join(dist, 'index.html'), '<p>首页</p>');
  const res = new Writable({ write(chunk, encoding, callback) { callback(new Error('client disconnected')); } });
  res.headersSent = false;
  res.writeHead = () => { res.headersSent = true; };
  const handler = createHandler({ router: createRouter(), distDir: dist, allowedPorts: [], logError: () => {} });
  await assert.doesNotReject(handler({ url: '/', method: 'GET', headers: { host: 'localhost' } }, res));
  assert.equal(res.destroyed, true);
});

test('流式发视频支持闭区间、开放区间、后缀区间；非法和越界回 416', async (t) => {
  const file = join(tempDir(), 'video.mp4');
  writeFileSync(file, Buffer.from('0123456789'));
  const router = createRouter();
  router.add('GET', '/api/video', ({ req, res }) => sendFile(res, file, { req }));
  const s = await listen(createHandler({ router, distDir: tempDir(), allowedPorts: [], logError: () => {} }));
  t.after(s.close);
  for (const [range, body, contentRange] of [['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=8-', '89', 'bytes 8-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=8-99', '89', 'bytes 8-9/10']]) {
    const r = await call(s.port, { path: '/api/video', headers: { Range: range } });
    assert.equal(r.status, 206);
    assert.equal(r.buffer.toString(), body);
    assert.equal(r.headers['content-range'], contentRange);
    assert.equal(r.headers['accept-ranges'], 'bytes');
    assert.equal(r.headers['content-type'], 'video/mp4');
  }
  for (const range of ['bytes=10-', 'bytes=7-2', 'bytes=-0', 'bytes=0-1,4-5', 'garbage']) {
    const r = await call(s.port, { path: '/api/video', headers: { Range: range } });
    assert.equal(r.status, 416);
    assert.equal(r.headers['content-range'], 'bytes */10');
    assert.equal(r.buffer.length, 0);
  }
  const all = await call(s.port, { path: '/api/video' });
  assert.equal(all.status, 200);
  assert.equal(all.buffer.toString(), '0123456789');
});

test('按 方法+路径 找到处理函数，query 能读到', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/ping?x=1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { pong: '1' });
  await s.close();
});

test('没有的接口回 404 和一句人话', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/nope' });
  assert.equal(r.status, 404);
  assert.equal(typeof r.json.error, 'string');
  await s.close();
});

test('HttpError 按它自己的状态码和话回', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/teapot' });
  assert.equal(r.status, 418);
  assert.equal(r.json.error, '我是茶壶');
  await s.close();
});

test('别的错只回一句通用话，细节只进日志，不把本机路径发给浏览器', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/boom' });
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.buffer.toString('utf8'), /secret/);
  assert.equal(s.errors.length, 1);
  await s.close();
});

test('POST 的 JSON 原样读到', async () => {
  const s = await boot();
  const r = await call(s.port, { method: 'POST', path: '/api/echo', headers: json, body: '{"a":1}' });
  assert.deepEqual(r.json, { a: 1 });
  await s.close();
});

test('POST 不说自己是 JSON 回 415（外站的「简单请求」发不了 JSON）', async () => {
  const s = await boot();
  const r = await call(s.port, { method: 'POST', path: '/api/echo', headers: { 'Content-Type': 'text/plain' }, body: '{"a":1}' });
  assert.equal(r.status, 415);
  await s.close();
});

test('外站页面发来的写请求一律 403', async () => {
  const s = await boot();
  const r = await call(s.port, { method: 'POST', path: '/api/echo', headers: { ...json, Origin: 'http://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  await s.close();
});

test('本机页面（允许的端口）能写', async () => {
  const s = await boot();
  const r = await call(s.port, { method: 'POST', path: '/api/echo', headers: { ...json, Origin: 'http://127.0.0.1:5290' }, body: '{}' });
  assert.equal(r.status, 200);
  await s.close();
});

test('Host 不是本机名字一律 403（挡 DNS 重绑定）', async () => {
  const s = await boot();
  const r = await call(s.port, { path: '/api/ping', headers: { Host: 'evil.example' } });
  assert.equal(r.status, 403);
  await s.close();
});

test('safeJoin 挡掉 ../ 穿越和坏编码', () => {
  const root = tempDir();
  assert.equal(safeJoin(root, '..%2F..%2Fsecret.txt'), null);
  assert.equal(safeJoin(root, '/%E0%A4%A'), null);
  assert.equal(safeJoin(root, '/a\0b'), null);
  assert.equal(safeJoin(root, '/assets/a.js'), join(root, 'assets', 'a.js'));
});

test('页面没打包时给一句人话，不是白屏', async () => {
  const s = await boot(tempDir());
  const r = await call(s.port, { path: '/' });
  assert.equal(r.status, 200);
  assert.match(r.buffer.toString('utf8'), /页面还没打包/);
  await s.close();
});

test('打包了就给页面；找不到的路径也给 index.html', async () => {
  const dist = tempDir();
  writeFileSync(join(dist, 'index.html'), '<p>首页</p>');
  mkdirSync(join(dist, 'assets'));
  writeFileSync(join(dist, 'assets', 'a.js'), 'console.log(1)');
  const s = await boot(dist);
  assert.equal((await call(s.port, { path: '/assets/a.js' })).buffer.toString(), 'console.log(1)');
  assert.match((await call(s.port, { path: '/whatever' })).buffer.toString('utf8'), /首页/);
  await s.close();
});
