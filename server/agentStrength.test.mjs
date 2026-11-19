import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRENGTHS, strengthOf, strengthValues } from './agentStrength.mjs';

// 11-19 用户定：写词强度三档——标准 = sonnet；更强 = opus + 中等强度；最强 = opus + XHigh。
test('三档对应的模型和强度照用户定的', () => {
  assert.deepEqual(STRENGTHS, { standard: { model: 'sonnet', effort: '' }, strong: { model: 'opus', effort: 'medium' }, max: { model: 'opus', effort: 'xhigh' } });
  assert.deepEqual(strengthValues('standard'), { CLAUDE_MODEL: 'sonnet', CLAUDE_EFFORT: '' });
  assert.deepEqual(strengthValues('strong'), { CLAUDE_MODEL: 'opus', CLAUDE_EFFORT: 'medium' });
  assert.deepEqual(strengthValues('max'), { CLAUDE_MODEL: 'opus', CLAUDE_EFFORT: 'xhigh' });
  for (const bad of ['custom', 'ultra', '', undefined, 7, 'constructor', '__proto__']) assert.equal(strengthValues(bad), null);
});

test('认出现在是哪档：没填 / 占位话算标准，大小写不管，手填的别的组合算自定义', () => {
  assert.equal(strengthOf({}), 'standard');
  assert.equal(strengthOf({ CLAUDE_MODEL: '请填本机Claude用的模型', CLAUDE_EFFORT: '请填本机Claude的思考强度' }), 'standard');
  assert.equal(strengthOf({ CLAUDE_MODEL: 'Opus', CLAUDE_EFFORT: 'Medium' }), 'strong');
  assert.equal(strengthOf({ CLAUDE_MODEL: 'opus', CLAUDE_EFFORT: 'xhigh' }), 'max');
  assert.equal(strengthOf({ CLAUDE_MODEL: 'opus' }), 'custom');
  assert.equal(strengthOf({ CLAUDE_MODEL: 'haiku' }), 'custom');
  assert.equal(strengthOf({ CLAUDE_MODEL: 'sonnet', CLAUDE_EFFORT: 'max' }), 'custom');
});
