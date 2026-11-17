import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { childEnv, cliArgs, claudeConfigDir, claudeHealth, createClaudeCall, findClaudeCli, parseCliOutput } from './claude.mjs';
import { tempDir } from './testKit.mjs';

// npm 装的 Claude Code 在 PATH 里是 claude.cmd：不开 shell 启动不了（Node 22 直接抛 spawn EINVAL），所以不认它，接着往下找 .exe。
test('找 claude：.env.local 填了就只认它；否则 PATH；最后桌面版自带的最新版本；.cmd 外壳启动不了、一律不认', () => {
  const files = new Set(['C:\\my\\claude.exe', 'C:\\my\\claude.cmd', 'C:\\bin\\claude.cmd', 'C:\\other\\claude.exe',
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.309\\abc\\claude.exe', 'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.400\\def\\claude.exe']);
  const dirs = { 'C:\\L\\Claude-Data': ['claude_x'], 'C:\\L\\Claude-Data\\claude_x\\claude-code': ['2.1.309', '2.1.400'],
    'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.400': ['def'], 'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.309': ['abc'] };
  const options = { exists: file => files.has(file) || file === 'C:\\L\\Claude-Data', readdir: dir => dirs[dir] ?? [], path: 'C:\\bin;C:\\other', localAppData: 'C:\\L', platform: 'win32' };
  assert.equal(findClaudeCli({ CLAUDE_CLI: 'C:\\my\\claude.exe' }, options), 'C:\\my\\claude.exe');
  assert.equal(findClaudeCli({ CLAUDE_CLI: 'C:\\gone\\claude.exe' }, options), '');
  assert.equal(findClaudeCli({ CLAUDE_CLI: 'C:\\my\\claude.cmd' }, options), '', '填的是 .cmd：当没配好，不拿去启动');
  assert.equal(findClaudeCli({}, options), 'C:\\other\\claude.exe', 'PATH 里前一个文件夹只有 claude.cmd，跳过它用后面的 claude.exe');
  assert.equal(findClaudeCli({}, { ...options, path: 'C:\\bin' }), 'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.400\\def\\claude.exe', 'PATH 里只有 claude.cmd：改用桌面版自带的');
  assert.equal(findClaudeCli({}, { ...options, path: 'C:\\bin', localAppData: '' }), '', '只有 claude.cmd：算没找到');
  assert.equal(findClaudeCli({}, { ...options, path: '' }), 'C:\\L\\Claude-Data\\claude_x\\claude-code\\2.1.400\\def\\claude.exe');
  assert.equal(findClaudeCli({}, { ...options, path: '', localAppData: '' }), '');
});

// 11-14 官方条款：开发者不能收集、存储、转交 Claude 的登录凭证，登录必须走官方流程。就绪只看用户自己的官方登录在不在，不读内容。
test('Claude 就绪 = 找到命令行 + 用户自己用官方方式登录过；.env.local 里的令牌不算、也不读', () => {
  const home = 'C:\\U\\.claude', login = join(home, '.credentials.json');
  const base = { exists: file => file === 'C:\\bin\\claude.exe', path: 'C:\\bin', localAppData: '', platform: 'win32', home };
  const logged = { ...base, exists: file => file === login || base.exists(file) };
  assert.deepEqual(claudeHealth({ CLAUDE_MODEL: 'opus' }, logged), { claudeReady: true, claudeCli: true, claudeLogin: true, claudeModel: 'opus' });
  assert.deepEqual(claudeHealth({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, base), { claudeReady: false, claudeCli: true, claudeLogin: false, claudeModel: 'sonnet' });
  assert.deepEqual(claudeHealth({}, { ...logged, path: '' }), { claudeReady: false, claudeCli: false, claudeLogin: true, claudeModel: 'sonnet' });
  assert.equal(claudeConfigDir({ CLAUDE_CONFIG_DIR: 'D:\\cfg' }, 'C:\\U'), 'D:\\cfg');
  assert.equal(claudeConfigDir({}, 'C:\\U'), join('C:\\U', '.claude'));
});

test('子进程环境去掉当前会话的 Claude Code 变量、API Key 和令牌（只用用户自己的官方登录）；参数只开 Read、不问权限、不存会话', () => {
  const env = childEnv({ PATH: 'x', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_AGENT_SDK_VERSION: '1', ANTHROPIC_BASE_URL: 'u',
    ANTHROPIC_API_KEY: 'k', CLAUDE_CODE_OAUTH_TOKEN: 't', CLAUDE_CONFIG_DIR: 'c', HOME: 'h' });
  assert.deepEqual(env, { PATH: 'x', CLAUDE_CONFIG_DIR: 'c', HOME: 'h' });
  const args = cliArgs({ userPrompt: '原话', system: '系统提示', model: 'sonnet' });
  // 用户原话放最后、前面隔一个 `--`：以「-」开头的话（像「- 背景换成海边」）不能被命令行当成选项（11-15 体检用真 claude.exe 复现过 unknown option）。
  assert.equal(args[0], '-p'); assert.deepEqual(args.slice(-2), ['--', '原话']);
  const dashed = cliArgs({ userPrompt: '- 背景换成海边', system: '系统提示', model: 'sonnet' });
  assert.deepEqual(dashed.slice(-2), ['--', '- 背景换成海边']); assert.equal(dashed.indexOf('- 背景换成海边'), dashed.length - 1);
  assert.equal(args[args.indexOf('--system-prompt') + 1], '系统提示');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  for (const pair of [['--output-format', 'json'], ['--tools', 'Read'], ['--allowedTools', 'Read'], ['--permission-prompts', 'none']]) assert.equal(args[args.indexOf(pair[0]) + 1], pair[1]);
  for (const flag of ['--safe-mode', '--no-session-persistence', '--disable-slash-commands']) assert.ok(args.includes(flag));
  assert.ok(!args.includes('--bare'));
});

test('解析回话：成功取 result、去掉代码块、合计输入 token；登录失败提示自己用官方方式登录；坏输出报人话', () => {
  const ok = parseCliOutput(JSON.stringify({ type: 'result', is_error: false, result: '```json\n{"a":1}\n```', duration_ms: 1200, modelUsage: { 'claude-sonnet-5-5': {} },
    usage: { input_tokens: 6, cache_read_input_tokens: 100, cache_creation_input_tokens: 200, output_tokens: 30 } }));
  assert.deepEqual(ok, { text: '{"a":1}', model: 'claude-sonnet-5-5', elapsedMs: 1200, usage: { input_tokens: 306, output_tokens: 30 } });
  assert.deepEqual(parseCliOutput(JSON.stringify({ result: 'x' })).usage, { input_tokens: 0, output_tokens: 0 });
  assert.throws(() => parseCliOutput(JSON.stringify({ is_error: true, result: 'Failed to authenticate: OAuth session expired' })),
    error => /没登录或登录过期.*运行 claude.*自己的.*账号登录/.test(error.message) && !/setup-token|令牌/.test(error.message));
  assert.throws(() => parseCliOutput(JSON.stringify({ is_error: true, result: 'rate limit' })), /调用失败：rate limit/);
  assert.throws(() => parseCliOutput('not json', 'stderr 原话'), /没有按格式回话.*stderr 原话/);
  assert.throws(() => parseCliOutput(JSON.stringify({ result: '   ' })), /空内容/);
});

test('调用：文件写进临时目录当工作目录、跑完删掉；模型默认 sonnet、.env.local 的 CLAUDE_MODEL 优先、调用时指定最优先；超时杀进程；没命令行报人话；不转交任何令牌', async () => {
  const tmpRoot = tempDir();
  const calls = [];
  const launch = (file, args, options) => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    const prompt = join(options.cwd, '提示词.txt');
    calls.push({ file, args, options, files: readdirSync(options.cwd).sort(), text: existsSync(prompt) ? readFileSync(prompt, 'utf8') : '' });
    setImmediate(() => { child.stdout.emit('data', JSON.stringify({ result: '{"ok":true}', duration_ms: 5, usage: { input_tokens: 10, output_tokens: 2 } })); child.emit('close', 0); });
    return child;
  };
  const env = { CLAUDE_CODE_OAUTH_TOKEN: 'tok', CLAUDE_MODEL: 'opus' };
  const call = createClaudeCall({ env, tmpRoot, launch, findCli: () => 'C:\\fake\\claude.exe', baseEnv: { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_OAUTH_TOKEN: 'sys' } });
  const files = [{ name: '提示词.txt', buffer: Buffer.from('词') }, { name: '图片1_人物.jpg', buffer: Buffer.from([1, 2]) }];
  const result = await call({ system: '系统', prompt: '看图', files });
  assert.deepEqual(result, { text: '{"ok":true}', model: '', elapsedMs: 5, usage: { input_tokens: 10, output_tokens: 2 } });
  assert.equal(calls[0].file, 'C:\\fake\\claude.exe');
  assert.deepEqual(calls[0].files, ['图片1_人物.jpg', '提示词.txt']);
  assert.equal(calls[0].text, '词');
  assert.equal(calls[0].options.env.CLAUDE_CODE_OAUTH_TOKEN, undefined, '.env.local 和系统里的令牌都不转交');
  assert.equal(calls[0].options.env.CLAUDECODE, undefined);
  assert.equal(calls[0].options.env.PATH, 'p');
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'opus');
  assert.equal(calls[0].args[calls[0].args.indexOf('--system-prompt') + 1], '系统');
  assert.equal(existsSync(calls[0].options.cwd), false);
  await call({ system: 's', prompt: 'p', model: 'haiku' });
  assert.equal(calls[1].args[calls[1].args.indexOf('--model') + 1], 'haiku');
  const plain = createClaudeCall({ env: {}, tmpRoot, launch, findCli: () => 'x' });
  await plain({ system: 's', prompt: 'p' });
  assert.equal(calls[2].args[calls[2].args.indexOf('--model') + 1], 'sonnet');
  const slow = createClaudeCall({ env, tmpRoot, timeoutMs: 5, findCli: () => 'x', launch: () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => child.emit('close', null); return child;
  } });
  await assert.rejects(slow({ system: 's', prompt: 'p' }), /分钟没回话/);
  await assert.rejects(createClaudeCall({ env, tmpRoot, findCli: () => '' })({ system: 's', prompt: 'p' }), /找不到 claude/);
  const broken = createClaudeCall({ env, tmpRoot, findCli: () => 'x', launch: () => { throw Error('spawn EINVAL'); } });
  await assert.rejects(broken({ system: 's', prompt: 'p' }), /启动 claude 失败：spawn EINVAL/, '启动那一下就抛错也要说人话');
  assert.deepEqual(readdirSync(tmpRoot), []);
});

// 11-17：刚用官方安装器装完 Claude Code，小服务进程里的 PATH 还是旧的。直接看它默认装的地方，设置里点「重新检查」就能认到，不用重启。
test('PATH 里没有：再看用户文件夹的 .local\\bin（官方安装器默认位置），排在桌面版自带那份前面', () => {
  const local = 'C:\\Users\\me\\.local\\bin\\claude.exe';
  const options = { exists: file => file === local, readdir: () => [], path: 'C:\\bin', localAppData: '', platform: 'win32', userHome: 'C:\\Users\\me' };
  assert.equal(findClaudeCli({}, options), local);
  assert.equal(findClaudeCli({}, { ...options, userHome: '' }), '');
});
