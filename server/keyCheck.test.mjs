import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { readEnvAt } from './config.mjs';
import { checkArkKey } from './keyCheck.mjs';
import { call, listen, tempDir } from './testKit.mjs';

// 11-17 用户定：设置里保存火山 Key 时顺手验一下，填错了当场说。全部假 fetch，不联网。
test('验 Key：只把 401 当成 Key 不对，别的状态算火山认了，连不上算没法验；请求只查任务、带这把 Key', async () => {
  const seen = [];
  const reply = status => async (url, options) => { seen.push({ url, options }); return { status }; };
  const env = { ARK_API_KEY: 'ark-test-value' };
  assert.equal(await checkArkKey(env, { fetch: reply(401) }), 'rejected');
  assert.equal(await checkArkKey(env, { fetch: reply(404) }), 'accepted');
  assert.equal(await checkArkKey(env, { fetch: reply(403) }), 'accepted');
  assert.equal(await checkArkKey(env, { fetch: reply(200) }), 'accepted');
  assert.equal(await checkArkKey(env, { fetch: async () => { throw Error('ETIMEDOUT'); } }), 'unknown');
  assert.equal(seen.length, 4);
  for (const { url, options } of seen) {
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-ggtv-key-check');
    assert.equal(options.method, undefined);
    assert.equal(options.body, undefined);
    assert.equal(options.headers.Authorization, 'Bearer ark-test-value');
  }
});

test('验 Key：没填或还是模板提示语就不发请求', async () => {
  let sent = 0;
  const fetch = async () => { sent++; return { status: 200 }; };
  assert.equal(await checkArkKey({}, { fetch }), 'unknown');
  assert.equal(await checkArkKey({ ARK_API_KEY: '请填火山方舟API密钥' }, { fetch }), 'unknown');
  assert.equal(sent, 0);
});

test('接口：保存了火山 Key 才验、回包带 keyCheck 不带值；只填 TOS 不验；验的过程出错不影响保存', async () => {
  const file = join(tempDir(), '.env.local');
  const checked = [];
  let answer = 'rejected';
  const app = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake: false, readEnv: () => readEnvAt(file), envFile: file,
    checkKey: async env => { checked.push(env.ARK_API_KEY); if (answer === 'boom') throw Error('炸了'); return answer; }, logError: () => {}, log: () => {} });
  const s = await listen(app.handler);
  const post = body => call(s.port, { method: 'POST', path: '/api/settings/keys', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const bad = await post({ ARK_API_KEY: 'ark-wrong-value' });
  assert.equal(bad.status, 200);
  assert.deepEqual(bad.json, { saved: ['ARK_API_KEY'], keyReady: true, tosReady: false, keyCheck: 'rejected' });
  assert.equal(JSON.stringify(bad.json).includes('ark-wrong-value'), false);
  assert.deepEqual(checked, ['ark-wrong-value']);

  const tosOnly = await post({ TOS_BUCKET: 'my-bucket' });
  assert.equal(tosOnly.status, 200); assert.equal('keyCheck' in tosOnly.json, false);
  assert.equal(checked.length, 1);

  answer = 'accepted';
  assert.equal((await post({ ARK_API_KEY: 'ark-right-value' })).json.keyCheck, 'accepted');
  answer = 'boom';
  const broken = await post({ ARK_API_KEY: 'ark-third-value' });
  assert.equal(broken.status, 200); assert.equal(broken.json.keyCheck, 'unknown');
  assert.equal(readEnvAt(file).ARK_API_KEY, 'ark-third-value');
  await s.close();
});
