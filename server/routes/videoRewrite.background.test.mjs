import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../videoRewrite/routeTestKit.mjs';

const body = (s, userText, extra = {}) => ({ cardId: 'rewrite-1', source: s.upload(15.05), userText, ...extra });

test('11-11 用户定：背景换不换都回背景帧，每个场景一项（假拆解单场景取正中、按有人）；页面传不传 background 都一样', async () => {
  const s = setup();
  for (const extra of [{}, { background: true }, { background: 'yes' }]) {
    const result = await s.call('POST', '/api/video-rewrite/analyze', body(s, '换衣服', extra));
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.backgroundFrames, [{ second: 7.53, empty: false }]);
    assert.equal(Object.hasOwn(result.json, 'backgroundFrame'), false);
  }
});

test('11-06 假模式原话写「假无人」走没人那条路；「假多场景」每个场景各一项', async () => {
  const s = setup();
  const empty = await s.call('POST', '/api/video-rewrite/analyze', body(s, '假无人，换衣服'));
  assert.deepEqual(empty.json.backgroundFrames, [{ second: 7.53, empty: true }]);
  const scenes = await s.call('POST', '/api/video-rewrite/analyze', body(s, '假多场景，换衣服'));
  assert.equal(scenes.json.backgroundFrames.length, 4);
  assert.deepEqual(scenes.json.backgroundFrames.map(frame => frame.second), scenes.json.plan.items.filter(item => item.kind === '场景').map(item => item.frame));
});
