import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeProductPrompt } from './writePrompt.mjs';
import { checkProductRules } from './rules.mjs';
import { planFixture, materialFixture, looksFixture } from './productFixture.mjs';

test('用户改短/改长生成时长后拼词仍是连续整数秒，结尾照当前设置，不修改拆解原单', () => {
  for (const duration of [4, 8, 15, 20]) {
    const input = { duration, sourceDuration: 15, model: 'doubao-seedance-2-5-260628', plan: planFixture(), materials: materialFixture() };
    const before = structuredClone(input.plan);
    const result = writeProductPrompt(input, looksFixture());
    assert.deepEqual(checkProductRules({ ...input, ...result }), [], `${duration}秒：${result.videoPrompt}`);
    assert.deepEqual(input.plan, before);
    if (duration < 14) assert.doesNotMatch(result.videoPrompt, /14-15 秒/);
  }
});
