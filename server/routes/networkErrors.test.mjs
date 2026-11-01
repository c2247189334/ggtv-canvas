import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, env } from '../videoRewrite/routeTestKit.mjs';

test('app到拆解路由再到豆包客户端贯通logError，DNS未发出返回中文且不记未知费用', async () => {
  const logs = []; let calls = 0;
  const s = setup({ fake: false, logError: (label, error) => logs.push({ label, message: error.message }),
    fetch: async () => {
      calls++;
      throw Object.assign(Error(`REAL_DNS_PIPE_MISSING ${env.ARK_API_KEY} ${env.TOS_SECRET_ACCESS_KEY}`), { notSent: true });
    } });
  const response = await s.call('POST', '/api/video-rewrite/analyze', {
    cardId: 'network-1', source: s.upload(15), userText: '把人物换成我的'
  });
  assert.equal(response.status, 502);
  assert.match(response.json.error, /假地址.*fake-IP.*TUN.*Clash Verge/);
  assert.match(response.json.error, /这次没发出去，没花钱/);
  assert.doesNotMatch(response.json.error, /REAL_DNS_PIPE_MISSING|test-rewrite-private|test-rewrite-secret/);
  assert.equal(response.json.yuan, 0);
  assert.equal(response.json.costUnknown, false);
  assert.equal(calls, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0].label, /豆包.*网络失败/);
  assert.match(logs[0].message, /REAL_DNS_PIPE_MISSING/);
  assert.doesNotMatch(logs[0].message, /test-rewrite-private|test-rewrite-secret/);
  assert.equal(s.app.stores.spend.totalOn(), 0);
});
