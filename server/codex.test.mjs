import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { codexArgs, codexHealth, codexPrompt, createCodexCall, findCodexCli, parseCodexEvents } from './codex.mjs';
import { tempDir } from './testKit.mjs';

const event = value => JSON.stringify(value);
const good = [event({ type: 'thread.started', thread_id: 't' }),
  event({ type: 'item.completed', item: { id: 'i0', type: 'error', message: 'Codex is ignoring 1 unrecognized configuration setting.' } }),
  event({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '先看图' } }),
  event({ type: 'item.completed', item: { id: 'i2', type: 'agent_message', text: '```json\n{"color":"蓝色"}\n```' } }),
  event({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 7 } })].join('\n');

test('找 codex：.env.local 的 CODEX_CLI 优先；再找 PATH；再挑桌面版里最新的一份；都没有返回空', () => {
  const files = new Set(['C:\\my\\codex.exe', 'C:\\bin\\codex.exe', 'L:\\OpenAI\\Codex\\bin\\old\\codex.exe', 'L:\\OpenAI\\Codex\\bin\\new\\codex.exe']);
  const times = { 'L:\\OpenAI\\Codex\\bin\\old\\codex.exe': 1, 'L:\\OpenAI\\Codex\\bin\\new\\codex.exe': 2 };
  const options = { exists: file => files.has(file) || file === 'L:\\OpenAI\\Codex\\bin', readdir: () => ['old', 'new'], mtime: file => times[file] ?? 0,
    path: 'C:\\bin', localAppData: 'L:\\', platform: 'win32' };
  assert.equal(findCodexCli({ CODEX_CLI: 'C:\\my\\codex.exe' }, options), 'C:\\my\\codex.exe');
  assert.equal(findCodexCli({ CODEX_CLI: 'C:\\missing\\codex.exe' }, options), '');
  assert.equal(findCodexCli({ CODEX_CLI: 'C:\\my\\codex.cmd' }, { ...options, exists: () => true }), '', 'npm 装出来的 codex.cmd 不开 shell 启动不了，不认');
  assert.equal(findCodexCli({}, options), 'C:\\bin\\codex.exe');
  assert.equal(findCodexCli({}, { ...options, path: '' }), join('L:\\OpenAI\\Codex\\bin', 'new', 'codex.exe'));
  assert.equal(findCodexCli({}, { ...options, path: '', localAppData: '' }), '');
});

test('就绪 = 命令行有 + codex login 登录过；只看 auth.json 在不在，模型没填就是默认', () => {
  const options = { exists: file => file === 'C:\\bin\\codex.exe' || file === join('H:\\.codex', 'auth.json'), path: 'C:\\bin', localAppData: '', platform: 'win32', home: 'H:\\.codex' };
  assert.deepEqual(codexHealth({ CODEX_MODEL: 'gpt-x' }, options), { ready: true, cli: true, login: true, model: 'gpt-x' });
  assert.deepEqual(codexHealth({}, { ...options, home: 'H:\\other' }), { ready: false, cli: true, login: false, model: '默认' });
  assert.deepEqual(codexHealth({}, { ...options, path: '' }), { ready: false, cli: false, login: true, model: '默认' });
});

test('参数：只读、不存会话、不读个人配置和 AGENTS.md、提问走标准输入；图按顺序逐张带上', () => {
  const args = codexArgs({ images: ['人物图-1.jpg', '人物图-2.jpg'], model: 'gpt-x' });
  assert.equal(args[0], 'exec');
  assert.equal(args[args.indexOf('-s') + 1], 'read-only');
  for (const flag of ['--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '--json']) assert.ok(args.includes(flag), flag);
  assert.ok(args.includes('project_doc_max_bytes=0'));
  assert.equal(args[args.indexOf('-m') + 1], 'gpt-x');
  assert.deepEqual(args.filter((_, i) => args[i - 1] === '-i'), ['人物图-1.jpg', '人物图-2.jpg']);
  assert.equal(args.at(-1), '-');
  assert.equal(args.at(-2), '--json', '-i 能吃多个值，提问的 - 不能紧跟在图后面');
  assert.equal(codexArgs({ images: [] }).includes('-m'), false);
});

test('提问：系统要求放最前；图说明它们是附件；文字材料直接贴进提问（本机 shell 读中文会乱码）', () => {
  const text = codexPrompt({ system: '系统', prompt: '看图', files: [{ name: '人物图-1.jpg', buffer: Buffer.from([1]) }, { name: '素材表.txt', buffer: Buffer.from('表格内容') }] });
  assert.ok(text.startsWith('系统'));
  assert.match(text, /人物图-1\.jpg/);
  assert.match(text, /Read/);
  assert.match(text, /素材表\.txt[\s\S]*表格内容/);
  assert.ok(text.indexOf('表格内容') < text.indexOf('看图'));
  assert.equal(codexPrompt({ system: '系统', prompt: '看图' }), '系统\n\n看图');
});

test('解析回话：取最后一条回话、去代码块；配置警告和重连不算失败；用量只算不带重复的输入', () => {
  assert.deepEqual(parseCodexEvents(good), { text: '{"color":"蓝色"}', usage: { input_tokens: 100, output_tokens: 7 } });
  const reconnect = [event({ type: 'error', message: 'Reconnecting... 1/5' }), event({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } }), event({ type: 'turn.completed', usage: {} })].join('\n');
  assert.equal(parseCodexEvents(reconnect).text, 'ok');
});

test('解析回话：真失败报人话；401 提示 codex login；没回话、空回话都报错', () => {
  const failed = message => event({ type: 'turn.failed', error: { message } });
  assert.throws(() => parseCodexEvents(failed('unexpected status 401 Unauthorized: Missing bearer')), /点「登录 Codex」/);
  assert.throws(() => parseCodexEvents(failed("The 'x' model is not supported")), /Codex 调用失败：The 'x' model/);
  assert.throws(() => parseCodexEvents('不是 JSON', '报错原文'), /Codex 没有按格式回话。报错原文/);
  assert.throws(() => parseCodexEvents(event({ type: 'turn.completed', usage: {} })), /空内容/);
});

function fakeChild(onClose) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  child.stdin = new EventEmitter();
  child.stdin.end = text => { child.input = text; setImmediate(() => onClose(child)); };
  return child;
}

test('调用：文件进临时目录、提问走标准输入、模型用 CODEX_MODEL 不认 Claude 的模型名、跑完删目录', async () => {
  const tmpRoot = tempDir(), calls = [];
  const launch = (file, args, options) => {
    const child = fakeChild(self => { calls[0].input = self.input; self.stdout.emit('data', good); self.emit('close', 0); });
    calls.push({ file, args, options, files: readdirSync(options.cwd).sort() });
    return child;
  };
  const call = createCodexCall({ env: { CODEX_MODEL: 'gpt-x' }, tmpRoot, launch, findCli: () => 'C:\\fake\\codex.exe', baseEnv: { PATH: 'p' } });
  const result = await call({ system: '系统', prompt: '看图', model: 'opus', files: [{ name: '人物图-1.jpg', buffer: Buffer.from([1]) }] });
  assert.deepEqual(result, { text: '{"color":"蓝色"}', model: 'gpt-x', elapsedMs: result.elapsedMs, usage: { input_tokens: 100, output_tokens: 7 } });
  assert.equal(typeof result.elapsedMs, 'number');
  assert.equal(calls[0].file, 'C:\\fake\\codex.exe');
  assert.deepEqual(calls[0].files, ['人物图-1.jpg']);
  assert.equal(calls[0].args[calls[0].args.indexOf('-m') + 1], 'gpt-x');
  assert.match(calls[0].input, /^系统/);
  assert.equal(existsSync(calls[0].options.cwd), false);
  assert.deepEqual(readdirSync(tmpRoot), []);
});

test('调用：没填 CODEX_MODEL 记成 codex；没命令行报人话；超时杀进程', async () => {
  const tmpRoot = tempDir();
  const launch = () => fakeChild(self => { self.stdout.emit('data', good); self.emit('close', 0); });
  const plain = await createCodexCall({ env: {}, tmpRoot, launch, findCli: () => 'x' })({ system: 's', prompt: 'p' });
  assert.equal(plain.model, 'codex');
  await assert.rejects(createCodexCall({ env: {}, tmpRoot, findCli: () => '' })({ system: 's', prompt: 'p' }), /找不到 codex/);
  const slow = createCodexCall({ env: {}, tmpRoot, timeoutMs: 5, findCli: () => 'x', launch: () => {
    const child = fakeChild(() => {}); child.kill = () => child.emit('close', null); return child;
  } });
  await assert.rejects(slow({ system: 's', prompt: 'p' }), /Codex 超过 .* 分钟没回话/);
  assert.deepEqual(readdirSync(tmpRoot), []);
});
