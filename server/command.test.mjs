import test from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../scripts/command.mjs';

// 11-01 真装：uv 失败只报「外部程序退出码：2」，用户和 Claude 都看不出原因。
test('外部程序失败时带上报错最后几行，网址里的账号密码换成 ***', async () => {
  const script = "for (let i = 1; i <= 8; i++) console.error('line ' + i);"
    + "console.error('error: proxy http://alice:s3cret@127.0.0.1:7890 refused'); process.exit(2);";
  const error = await execute(process.execPath, ['-e', script]).catch(e => e);
  assert.equal(error.code, 2);
  assert.match(error.message, /外部程序退出码：2/);
  assert.match(error.message, /error: proxy http:\/\/\*\*\*@127\.0\.0\.1:7890 refused/);
  assert.match(error.message, /line 8/);
  assert.doesNotMatch(error.message, /line 1\b/);
  assert.doesNotMatch(error.message, /alice|s3cret/);
});

test('外部程序成功时照旧只返回 stdout', async () => {
  const result = await execute(process.execPath, ['-e', "console.log('ok'); console.error('warn')"]);
  assert.equal(result.stdout.trim(), 'ok');
});
