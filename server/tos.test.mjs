import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTos, signedURL, tosConfig } from './tos.mjs';

const env = { TOS_BUCKET: 'test-bucket', TOS_ACCESS_KEY_ID: 'test-ak', TOS_SECRET_ACCESS_KEY: 'test-sk' };
const now = new Date('2026-10-22T12:00:00Z');

test('签名搬运没走样：旧项目算法、固定假密钥和时间的回归测试', () => {
  // 用旧项目指定函数，仅替换允许前缀，独立运行得到固定签名，证明搬运没走样。
  assert.equal(signedURL(tosConfig(env), 'GET', 'infinite-canvas/reference-test.mp4', 86400, now),
    'https://test-bucket.tos-cn-beijing.volces.com/infinite-canvas/reference-test.mp4?X-Tos-Algorithm=TOS4-HMAC-SHA256&X-Tos-Credential=test-ak%2F20261022%2Fcn-beijing%2Ftos%2Frequest&X-Tos-Date=20261022T120000Z&X-Tos-Expires=86400&X-Tos-SignedHeaders=host&X-Tos-Signature=add1da35b9360703031d10cbee84d8c7f69a45ac6c454beb42c8255bc98b226d');
  assert.throws(() => signedURL(tosConfig(env), 'GET', 'seedance-test/a.mp4'), /SIGNING_SCOPE_INVALID/);
  assert.throws(() => signedURL(tosConfig(env), 'DELETE', 'infinite-canvas/a.mp4'), /SIGNING_SCOPE_INVALID/);
  assert.equal(tosConfig({ ...env, TOS_REGION: 'other' }).TOS_REGION, 'cn-beijing');
});

test('缺任一配置明确报变量名和没花钱，不打印值', async () => {
  for (const name of Object.keys(env)) {
    const incomplete = { ...env, [name]: '' };
    await assert.rejects(createTos({ env: incomplete, fetch: async () => assert.fail('不应联网') }).uploadVideo({ buffer: Buffer.from('x') }),
      (err) => err.code === `${name}_MISSING` && err.message.includes(name) && err.message.includes('没花钱') && !err.message.includes('test-sk'));
  }
});

test('内容哈希命名：404才PUT，GET回读对哈希，返回24小时GET地址', async () => {
  const buffer = Buffer.from('video');
  const calls = [];
  const c = createTos({ env, now: () => now, fetch: async (url, options = {}) => {
    calls.push({ url, ...options });
    return calls.length === 1 ? new Response(null, { status: 404 }) : new Response(buffer);
  } });
  const url = await c.uploadVideo({ buffer, contentType: 'video/quicktime' });
  assert.deepEqual(calls.map((x) => x.method ?? 'GET'), ['GET', 'PUT', 'GET']);
  const hash = createHash('sha256').update(buffer).digest('hex');
  assert.equal(new URL(url).pathname, `/infinite-canvas/reference-${hash}.mov`);
  assert.equal(new URL(url).searchParams.get('X-Tos-Expires'), '86400');
  assert.equal(calls[1].headers['Content-Type'], 'video/quicktime');
  assert.deepEqual(calls[1].body, buffer);
});

test('已经存在就不PUT；非404、哈希不一致和网络失败都明确停止且不泄密', async () => {
  let calls = 0;
  await createTos({ env, fetch: async () => { calls += 1; return new Response('video'); } }).uploadVideo({ buffer: Buffer.from('video') });
  assert.equal(calls, 1);
  for (const fetch of [async () => new Response(null, { status: 403 }), async () => new Response('wrong'), async () => { throw Error('test-sk'); }]) {
    await assert.rejects(createTos({ env, fetch }).uploadVideo({ buffer: Buffer.from('video') }), (err) => /没花钱/.test(err.message) && !err.message.includes('test-sk'));
  }
});

test('TOS最后一道保险：200MB可通过，超过1字节或空文件拒收且不发请求', async () => {
  const buffer = Buffer.alloc(209715200);
  let calls = 0;
  await createTos({ env, fetch: async () => {
    calls++;
    return { status: 200, arrayBuffer: async () => buffer };
  } }).uploadVideo({ buffer });
  assert.equal(calls, 1);
  for (const buffer of [Buffer.alloc(209715201), Buffer.alloc(0)]) {
    await assert.rejects(createTos({ env, fetch: async () => assert.fail('大小违规不得联网') }).uploadVideo({ buffer }),
      error => error.code === 'TOS_VIDEO_SIZE_INVALID' && error.notSent === true);
  }
});

test('PUT按大小给慢网上传时间，最多30分钟，GET仍是60秒', async () => {
  for (const size of [6 * 1024 * 1024, 32 * 1024 * 1024]) {
    const buffer = Buffer.alloc(size);
    const calls = [];
    await createTos({ env, fetch: async (url, options) => {
      calls.push({ url, ...options });
      return calls.length === 1 ? new Response(null, { status: 404 }) : new Response(buffer);
    } }).uploadVideo({ buffer });
    assert.deepEqual(calls.map(call => call.timeout), [60000, Math.min(1800000, 120000 + size / 16384 * 1000), 60000]);
    assert.ok(Number(new URL(calls[1].url).searchParams.get('X-Tos-Expires')) * 1000 >= calls[1].timeout);
  }
});

test('只有PUT总时限到期才标上传太慢，其他传输失败保持原码', async () => {
  for (const [stage, original, expected] of [
    ['PUT', Object.assign(Error('aborted'), { code: 'ABORT_ERR', cause: new DOMException('timeout', 'TimeoutError') }), 'TOS_UPLOAD_TIMEOUT'],
    ['PUT', new DOMException('timeout', 'TimeoutError'), 'TOS_UPLOAD_TIMEOUT'],
    ['GET', new DOMException('timeout', 'TimeoutError'), 'TOS_TRANSFER_FAILED'],
    ['PUT', Object.assign(Error('reset'), { code: 'ECONNRESET' }), 'TOS_TRANSFER_FAILED']
  ]) {
    await assert.rejects(createTos({ env, fetch: async (_url, options) => {
      if ((options.method ?? 'GET') === stage) throw original;
      return new Response(null, { status: 404 });
    } }).uploadVideo({ buffer: Buffer.from('video') }), error => error.code === expected && error.notSent === true);
  }
});
