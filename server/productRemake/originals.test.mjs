import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeProductPrompt } from './writePrompt.mjs';
import { checkProductRules } from './rules.mjs';
import { planFixture, materialFixture, looksFixture } from './productFixture.mjs';
test('商品名称和外观项目名称也不能把原片外观带回提示词', () => {
  const plan = planFixture();
  plan.products[0].name = plan.products[0].look;
  plan.looks[0].what = plan.looks[0].now;
  const input = { duration: 15, model: 'doubao-seedance-2-0-260128', plan, materials: materialFixture() };
  const result = writeProductPrompt(input, looksFixture());
  assert.doesNotMatch(result.videoPrompt, /原片黑色厚底鞋|米黄格纹地砖/);
  assert.deepEqual(checkProductRules({ ...input, ...result }), []);
});
