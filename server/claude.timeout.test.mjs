import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createClaudeCall } from './claude.mjs';
import { tempDir } from './testKit.mjs';

// 看图定稿要看十来张图，单次放宽到 10 分钟；其他调用照旧用统一的超时。
test('单次调用可以自带超时，覆盖统一的', async () => {
  let killed = 0;
  const launch = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { killed++; };
    return child;
  };
  const call = createClaudeCall({ env: {}, tmpRoot: tempDir(), launch, findCli: () => 'claude', timeoutMs: 60000 });
  await assert.rejects(call({ system: 's', prompt: 'p', timeoutMs: 5 }), /超过 0 分钟没回话/);
  assert.equal(killed, 1);
});
