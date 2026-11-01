import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { boundDNS, pickDnsPipe, transport, watchSend } from './net.mjs';

test('pickDnsPipe：老版本 Clash Verge 的管道名原样用', () => {
  assert.equal(pickDnsPipe(['clash-verge-service', 'verge-mihomo']), 'verge-mihomo');
});

test('pickDnsPipe：2.5.x 管道名带后缀也认得出（2026-09-24 就是栽在这）', () => {
  const name = 'verge-mihomo-production-9e45cf568e2d960dfb3ae9022e54e8a92761202f08ace977257830f28c017791';
  assert.equal(pickDnsPipe(['clash-verge-service', name]), name);
});

test('pickDnsPipe：旧名和带后缀的同时在，优先旧名（和改之前行为一致）', () => {
  assert.equal(pickDnsPipe(['verge-mihomo-production-abc', 'verge-mihomo']), 'verge-mihomo');
});

test('pickDnsPipe：好几个带后缀的，优先 production', () => {
  assert.equal(pickDnsPipe(['verge-mihomo-dev-1', 'verge-mihomo-production-2']), 'verge-mihomo-production-2');
});

test('pickDnsPipe：长得像但不是的名字不认', () => {
  assert.equal(pickDnsPipe(['verge-mihomo2', 'my-verge-mihomo', 'clash-verge-service']), null);
});

test('pickDnsPipe：一个都没有返回 null', () => {
  assert.equal(pickDnsPipe([]), null);
});

// ---------- 2026-11-01：没有 Clash Verge 管道时，从物理网卡直接问公共 DNS ----------
function fakeResolver(answer) {
  const seen = {};
  return { seen, setServers(list) { seen.servers = list; }, setLocalAddress(address) { seen.local = address; },
    async resolve4(host) { seen.host = host; if (answer instanceof Error) throw answer; return answer; } };
}

test('boundDNS：从物理网卡问阿里 / 腾讯 DNS，取第一个公网地址', async () => {
  const resolver = fakeResolver(['198.18.0.5', '10.0.0.1', '101.126.13.31']);
  assert.equal(await boundDNS('ark.cn-beijing.volces.com', '192.168.1.20', resolver), '101.126.13.31');
  assert.deepEqual(resolver.seen, { servers: ['223.5.5.5', '119.29.29.29'], local: '192.168.1.20', host: 'ark.cn-beijing.volces.com' });
});

test('boundDNS：代理连这条也劫持（还是假地址）或者问不通，返回 null', async () => {
  assert.equal(await boundDNS('ark.cn-beijing.volces.com', '192.168.1.20', fakeResolver(['198.18.0.5'])), null);
  assert.equal(await boundDNS('ark.cn-beijing.volces.com', '192.168.1.20', fakeResolver(Object.assign(Error('timeout'), { code: 'ETIMEOUT' }))), null);
});

// ---------- 2026-10-14：请求还没完整发出去就出错 → 错误上标 notSent（扣分接口据此全退）----------
// 全在本机：连一个刚关掉的端口（连接阶段失败）、连一个收完整个请求才掐断连接的小服务（发完之后失败）。

async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('watchSend：连接阶段就失败（ECONNREFUSED）→ notSent = true', async () => {
  const port = await closedPort();
  const err = await new Promise((resolve) => {
    const req = httpRequest({ host: '127.0.0.1', port, method: 'POST' });
    watchSend(req, resolve);
    req.end(Buffer.from('{"a":1}'));
  });
  assert.equal(err.syscall, 'connect');
  assert.equal(err.notSent, true);
});

test('watchSend：整个请求已经发出去、对面才掐断 → 不标 notSent（结果不明）', async () => {
  const server = createServer((req) => {
    req.resume();
    req.on('end', () => req.socket.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const err = await new Promise((resolve) => {
      const req = httpRequest({ host: '127.0.0.1', port: server.address().port, method: 'POST' });
      watchSend(req, resolve);
      req.end(Buffer.from('{"a":1}'));
    });
    assert.ok(err instanceof Error);
    assert.equal(err.notSent, undefined);
  } finally {
    server.close();
  }
});

test('transport.fetch：路由阶段（地址不在白名单 / 不是 https）就拦下的错误标 notSent', async () => {
  const net = transport({ TOS_BUCKET: 'bucket' });
  const blocked = await net.fetch('https://evil.example.com/x').catch((e) => e);
  assert.equal(blocked.message, 'HOST_NOT_ALLOWED');
  assert.equal(blocked.notSent, true);
  const plain = await net.fetch('http://ark.cn-beijing.volces.com/x').catch((e) => e);
  assert.equal(plain.message, 'URL_NOT_ALLOWED');
  assert.equal(plain.notSent, true);
});
