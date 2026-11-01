import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { streamResponse } from './streamNet.mjs';

const fakeReply = (status = 200) => {
  const res = Object.assign(new PassThrough(), { statusCode: status, headers: { 'content-type': 'text/event-stream', 'x-multi': ['a', 'b'] } });
  const req = Object.assign(new EventEmitter(), { destroyed: 0, destroy() { this.destroyed++; } });
  return { res, req, response: streamResponse(res, req) };
};

test('回包边收边交：先拿到状态和头，数据按到达顺序读出', async () => {
  const { res, response } = fakeReply();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  assert.equal(response.headers.get('x-multi'), 'a, b');
  const reader = response.body.getReader();
  res.write('data: 1\n\n');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: 1\n\n');
  res.end('data: [DONE]\n\n');
  assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: [DONE]\n\n');
  assert.equal((await reader.read()).done, true);
});

test('读的一方不要了就关掉连接；连接中途断、请求报错（含30分钟总上限到点）都传到读的一方', async () => {
  const cancelled = fakeReply();
  await cancelled.response.body.cancel();
  assert.equal(cancelled.req.destroyed, 1);

  const cut = fakeReply();
  const reading = cut.response.body.getReader().read();
  cut.res.emit('aborted');
  await assert.rejects(reading, /RESPONSE_INTERRUPTED/);

  const timedOut = fakeReply();
  const waiting = timedOut.response.body.getReader().read();
  timedOut.req.emit('error', Object.assign(Error('The operation was aborted'), { name: 'AbortError' }));
  await assert.rejects(waiting, { name: 'AbortError' });
  timedOut.res.write('late');
  timedOut.res.end();
});

test('回包超过64MB就断开，不无限收', async () => {
  const { res, req, response } = fakeReply();
  const reader = response.body.getReader();
  res.write(Buffer.alloc(64 * 1024 * 1024 + 1));
  await assert.rejects(reader.read(), /RESPONSE_TOO_LARGE/);
  assert.equal(req.destroyed, 1);
});
