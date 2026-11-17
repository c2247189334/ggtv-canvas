import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from './app.mjs';
import { readEnvAt } from './config.mjs';
import { checkKeyValues, mergeEnvText, saveKeys } from './envWrite.mjs';
import { call, listen, tempDir } from './testKit.mjs';

const TOS = { TOS_ACCESS_KEY_ID: 'AKLTtest', TOS_SECRET_ACCESS_KEY: 'c2VjcmV0==', TOS_BUCKET: 'my-bucket' };

test('检查：只收 4 项、空的跳过、全空拒收、带空格引号中文 # 的拒收，报错不带值', () => {
  assert.deepEqual(checkKeyValues({ ARK_API_KEY: '  abc-123  ', TOS_BUCKET: '' }), { ARK_API_KEY: 'abc-123' });
  assert.throws(() => checkKeyValues({ ARK_API_KEY: '   ' }), /什么都没填/);
  assert.throws(() => checkKeyValues({ DEPTH_PYTHON: 'x' }), /不认识/);
  assert.throws(() => checkKeyValues({ ARK_API_KEY: 1 }), /一段文字/);
  assert.throws(() => checkKeyValues(null), /格式不对/);
  for (const bad of ['ab c', 'ab"c', "ab'c", 'ab#c', 'ab\\c', '密钥abc', 'a\nb', 'x'.repeat(513)]) {
    assert.throws(() => checkKeyValues({ ARK_API_KEY: bad }), err => /火山方舟 API Key/.test(err.message) && !err.message.includes(bad));
  }
});

test('合并：已有的行整行换（重复的都换）、没有的加在最后，别的行和换行符原样', () => {
  const text = '# 注释 ARK_API_KEY=别动\r\nARK_API_KEY=请填火山方舟API密钥\r\nDEPTH_PYTHON=C:/py.exe\r\nexport ARK_API_KEY=旧的\r\n';
  assert.equal(mergeEnvText(text, { ARK_API_KEY: 'new', TOS_BUCKET: 'b' }),
    '# 注释 ARK_API_KEY=别动\r\nARK_API_KEY=new\r\nDEPTH_PYTHON=C:/py.exe\r\nARK_API_KEY=new\r\nTOS_BUCKET=b\r\n');
  assert.equal(mergeEnvText('A=1', { TOS_BUCKET: 'b' }), 'A=1\nTOS_BUCKET=b\n');
  assert.equal(mergeEnvText('', { TOS_BUCKET: 'b' }), 'TOS_BUCKET=b\n');
  // 值里带 $ 不会被当成替换记号。
  assert.equal(mergeEnvText('ARK_API_KEY=x\n', { ARK_API_KEY: 'a$&b' }), 'ARK_API_KEY=a$&b\n');
});

test('保存：没有 .env.local 就照模板抄一份再填；已有就只换填的那几项，读回来就是填的值', () => {
  const dir = tempDir(), file = join(dir, '.env.local'), template = join(dir, '.env.example');
  writeFileSync(template, 'ARK_API_KEY=请填火山方舟API密钥\nTOS_BUCKET=请填北京区TOS桶名\nAGENT_ENGINE=请填\n');
  assert.deepEqual(saveKeys(file, { ARK_API_KEY: 'ark-1' }, { template }), { saved: ['ARK_API_KEY'], keyReady: true, tosReady: false });
  assert.equal(readFileSync(file, 'utf8'), 'ARK_API_KEY=ark-1\nTOS_BUCKET=请填北京区TOS桶名\nAGENT_ENGINE=请填\n');
  assert.equal(readFileSync(template, 'utf8').includes('ark-1'), false);
  writeFileSync(file, '\uFEFFARK_API_KEY=ark-1\nCODEX_MODEL=gpt\n');
  assert.deepEqual(saveKeys(file, { ...TOS, ARK_API_KEY: '' }, { template }), { saved: Object.keys(TOS), keyReady: true, tosReady: true });
  const env = readEnvAt(file);
  assert.equal(env.ARK_API_KEY, 'ark-1'); assert.equal(env.CODEX_MODEL, 'gpt');
  for (const [name, value] of Object.entries(TOS)) assert.equal(env[name], value);
  assert.ok(readFileSync(file, 'utf8').startsWith('\uFEFFARK_API_KEY=ark-1\n'));
});

test('保存：没有模板也能建；格式不对一个字都不写', () => {
  const dir = tempDir(), file = join(dir, '.env.local');
  assert.throws(() => saveKeys(file, { ARK_API_KEY: 'a b' }), /空格/);
  assert.equal(existsSync(file), false);
  saveKeys(file, { ARK_API_KEY: 'ark-2' }, { template: join(dir, '没有.example') });
  assert.equal(readFileSync(file, 'utf8'), 'ARK_API_KEY=ark-2\n');
});

test('接口：填好 health 立刻变已填，回包只有填没填、不带值；没指定配置文件就拒收', async () => {
  const dir = tempDir(), file = join(dir, '.env.local');
  const app = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake: false, readEnv: () => readEnvAt(file),
    envFile: file, logError: () => {}, log: () => {} });
  const s = await listen(app.handler);
  const post = body => call(s.port, { method: 'POST', path: '/api/settings/keys', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await call(s.port, { path: '/api/health' })).json.keyReady, false);
  const saved = await post({ ARK_API_KEY: 'ark-secret-value', ...TOS });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json, { saved: ['ARK_API_KEY', ...Object.keys(TOS)], keyReady: true, tosReady: true });
  assert.equal(JSON.stringify(saved.json).includes('ark-secret-value'), false);
  const health = (await call(s.port, { path: '/api/health' })).json;
  assert.equal(health.keyReady, true); assert.equal(health.tosReady, true);
  assert.equal(JSON.stringify(health).includes('ark-secret-value'), false);
  const bad = await post({ ARK_API_KEY: 'x"y' });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /引号/);
  assert.equal(readEnvAt(file).ARK_API_KEY, 'ark-secret-value');
  await s.close();

  const bare = createApp({ dataRoot: tempDir(), distDir: tempDir(), port: 5290, fake: false, readEnv: () => ({}), logError: () => {}, log: () => {} });
  const b = await listen(bare.handler);
  const refused = await call(b.port, { method: 'POST', path: '/api/settings/keys', headers: { 'Content-Type': 'application/json' }, body: '{"ARK_API_KEY":"a"}' });
  assert.equal(refused.status, 400); assert.match(refused.json.error, /手动填/);
  await b.close();
});
