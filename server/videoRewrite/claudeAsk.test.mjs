import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_SYSTEM, askPrompt, createClaudeAsk, imageNames } from './claudeAsk.mjs';

test('图片命名：拆解按「另附N张」分总览大图和清楚大图，看人物图按顺序编号；没图不写文件清单', () => {
  assert.deepEqual(imageNames('analyze', 3, '看总览大图：…另附2张原片清楚大图，依次是1.3、3.8秒的画面。'), ['总览大图-1.jpg', '清楚大图-1.jpg', '清楚大图-2.jpg']);
  assert.deepEqual(imageNames('analyze', 2, '看总览大图：共2张'), ['总览大图-1.jpg', '总览大图-2.jpg']);
  assert.deepEqual(imageNames('look', 2), ['人物图-1.jpg', '人物图-2.jpg']);
  assert.match(askPrompt(['人物图-1.jpg'], '问题'), /^图片都在当前目录：人物图-1\.jpg（按编号顺序对应提问里的图）。先用 Read 逐张看完[\s\S]*\n\n问题$/);
  assert.equal(askPrompt([], '问题'), '问题');
});

test('问 Claude：图解码成文件、系统提示固定、模型按配置；回话解析成 JSON、记 0 元账；坏回话报人话', async () => {
  const calls = [], charges = [];
  const call = async input => { calls.push(input); return { text: '```json\n{"people":[{"id":"P1"}]}\n```', model: 'claude-sonnet-5-5', elapsedMs: 9, usage: { input_tokens: 5, output_tokens: 1 } }; };
  const ask = createClaudeAsk({ call, model: 'sonnet', onCharge: row => charges.push(row) });
  const png = Buffer.from([137, 80, 78, 71]);
  const reply = await ask({ round: 'analyze', text: '看总览大图：…另附1张原片清楚大图', images: [`data:image/jpeg;base64,${png.toString('base64')}`, `data:image/jpeg;base64,${png.toString('base64')}`] });
  assert.deepEqual(reply, { people: [{ id: 'P1' }] });
  assert.equal(calls[0].system, ASK_SYSTEM); assert.equal(calls[0].model, 'sonnet');
  assert.deepEqual(calls[0].files.map(file => file.name), ['总览大图-1.jpg', '清楚大图-1.jpg']);
  assert.deepEqual(calls[0].files[0].buffer, png);
  assert.match(calls[0].prompt, /总览大图-1\.jpg、清楚大图-1\.jpg[\s\S]*看总览大图：…另附1张/);
  assert.deepEqual(charges, [{ usage: { input_tokens: 5, output_tokens: 1 }, model: 'claude-sonnet-5-5', yuan: 0 }]);
  const bad = createClaudeAsk({ call: async () => ({ text: '不是 JSON', model: '', usage: {} }), model: 'sonnet' });
  await assert.rejects(bad({ round: 'look', text: '问', images: [] }), /Claude 回话不是合法JSON：不是 JSON/);
  const blank = createClaudeAsk({ call: async () => ({ text: '{"a":1}', model: '', usage: {} }), model: 'haiku', onCharge: row => charges.push(row) });
  await blank({ round: 'look', text: '问' });
  assert.equal(charges.at(-1).model, 'claude-haiku');
});
