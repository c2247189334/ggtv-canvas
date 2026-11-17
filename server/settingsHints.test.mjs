// 11-17 用户定：缺 Key / TOS、Key 被拒时，提示都指去页面右上角「设置」（那里能直接填），不再叫新手改 .env.local。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyMissingText, tosMissingText } from './config.mjs';
import { humanError, rejectedText } from './queue.mjs';
import { humanSeedanceError } from './seedance.mjs';
import { tosConfig } from './tos.mjs';

const pointsToSettings = text => { assert.match(text, /右上角「设置」/); assert.doesNotMatch(text, /\.env\.local/); assert.match(text, /不用重启/); };

test('缺 Key、缺 TOS：指去「设置」，变量名留在括号里，说清没发出去', () => {
  for (const text of [keyMissingText(), humanError('ARK_KEY_MISSING'), humanSeedanceError({ code: 'ARK_KEY_MISSING', outcome: 'notSent' })]) {
    pointsToSettings(text); assert.match(text, /火山 Key（ARK_API_KEY）/); assert.match(text, /没发出去/);
  }
  const all = tosMissingText();
  pointsToSettings(all);
  for (const name of ['TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY', 'TOS_BUCKET']) assert.ok(all.includes(name));
  for (const [env, name] of [[{}, 'TOS_ACCESS_KEY_ID'], [{ TOS_ACCESS_KEY_ID: 'a', TOS_SECRET_ACCESS_KEY: 'b' }, 'TOS_BUCKET']]) {
    assert.throws(() => tosConfig(env), err => { pointsToSettings(err.message); return err.message.includes(name) && err.code === `${name}_MISSING` && err.notSent; });
  }
});

test('火山回 401：补一句 Key 可能填错、去「设置」重填；别的码不补', () => {
  const unauthorized = rejectedText(401, 'The API key is invalid');
  assert.match(unauthorized, /^火山没接（401）：The API key is invalid /);
  pointsToSettings(unauthorized);
  assert.match(unauthorized, /Key 可能填错了或已失效/);
  assert.equal(rejectedText(400, '提示词不合规'), '火山没接（400）：提示词不合规');
  const video = humanSeedanceError({ code: 'AuthenticationError', message: 'bad key', status: 401 });
  assert.match(video, /bad key 火山没建任务。火山 Key 可能填错了/);
  assert.doesNotMatch(humanSeedanceError({ code: 'InvalidParameter', message: 'x', status: 400 }), /可能填错/);
});
