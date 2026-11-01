import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('tempDir 建的临时目录，进程一退出就被删掉', () => {
  const kit = new URL('./testKit.mjs', import.meta.url).href;
  const script = 'const { tempDir } = await import(process.argv[1]); console.log(tempDir());';
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', script, kit], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const dir = out.stdout.trim();
  assert.ok(dir.length > 0);
  assert.equal(existsSync(dir), false);
});
