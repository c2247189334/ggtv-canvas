import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRewrite } from './rewrite.mjs';
import { createModel } from './videoRewrite/client.mjs';

const env = { ARK_API_KEY: 'network-test-key', TOS_SECRET_ACCESS_KEY: 'network-test-secret' };
const cases = [
  ['REAL_DNS_PIPE_MISSING', /假地址.*fake-IP.*TUN.*Clash Verge.*关掉|假地址.*fake-IP.*TUN.*Clash Verge.*关闭/],
  ['PUBLIC_DNS_MISSING', /这台电脑连不上火山.*检查一下网络/],
  ['PHYSICAL_ROUTE_READ_FAILED', /这台电脑连不上火山.*检查一下网络/],
  ['PHYSICAL_ROUTE_AMBIGUOUS', /这台电脑连不上火山.*检查一下网络/],
  ['ECONNRESET', /这台电脑连不上火山.*检查一下网络/]
];

for (const client of ['rewrite', 'model']) {
  test(`${client} 网络失败只返回中文处理办法，技术原因脱敏后记日志，不重发`, async () => {
    for (const [code, expected] of cases) {
      let calls = 0;
      const logs = [];
      const failure = Object.assign(Error(`${code} ${env.ARK_API_KEY} ${env.TOS_SECRET_ACCESS_KEY}`), { code, notSent: true });
      const options = { env, logError: (tag, error) => logs.push({ tag, message: error.message }),
        fetch: async () => { calls++; throw failure; } };
      const run = client === 'rewrite' ? () => createRewrite(options)({ kind: 'image', prompt: '猫' })
        : () => createModel(options)({ text: '检查画面' });
      await assert.rejects(run(), error => {
        assert.match(error.message, expected);
        assert.match(error.message, /这次没发出去，没花钱/);
        assert.doesNotMatch(error.message, /REAL_DNS|PUBLIC_DNS|PHYSICAL_ROUTE|ECONNRESET|network-test/);
        return true;
      });
      assert.equal(calls, 1);
      assert.equal(logs.length, 1);
      assert.ok(logs[0].message.includes(code));
      assert.doesNotMatch(logs[0].message, /network-test-key|network-test-secret/);
    }
  });
}

test('网络回话中途失败也说中文，不把执行环境原文交给用户', async () => {
  for (const client of ['rewrite', 'model']) {
    const logs = [];
    const options = { env, logError: (tag, error) => logs.push(error.message), fetch: async () => ({
      headers: new Headers(), status: 200,
      arrayBuffer: async () => { throw Error('read ECONNRESET ' + env.ARK_API_KEY); }
    }) };
    const run = client === 'rewrite' ? () => createRewrite(options)({ kind: 'image', prompt: '猫' })
      : () => createModel(options)({ text: '检查画面' });
    await assert.rejects(run(), /这台电脑连不上火山.*检查一下网络/);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /ECONNRESET/);
    assert.doesNotMatch(logs[0], /network-test-key/);
  }
});

test('豆包明确未发出的网络错误不标费用未知；已发出或无法确认时仍保留未知标志', async () => {
  for (const notSent of [true, false, undefined]) {
    let unknown = 0, calls = 0;
    const charges = [];
    const failure = Object.assign(Error('REAL_DNS_PIPE_MISSING'), notSent === undefined ? {} : { notSent });
    const ask = createModel({ env, onCharge: row => charges.push(row), onUnknown: () => { unknown++; },
      fetch: async () => { calls++; throw failure; } });
    await assert.rejects(ask({ text: '检查画面' }), /假地址.*Clash Verge/);
    assert.equal(unknown, notSent === true ? 0 : 1);
    assert.deepEqual(charges, []);
    assert.equal(calls, 1);
  }
});
