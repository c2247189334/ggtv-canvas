import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { join } from 'node:path';
import { agentHealth, agentOf, createAgentCall } from './agent.mjs';
import { tempDir } from './testKit.mjs';

const claudeHome = 'C:\\U\\.claude';
const claudeOptions = { exists: file => file === 'C:\\bin\\claude.exe' || file === join(claudeHome, '.credentials.json'), path: 'C:\\bin', localAppData: '', platform: 'win32', home: claudeHome };
const codexOptions = { exists: file => file === 'C:\\bin\\codex.exe' || file.endsWith('auth.json'), path: 'C:\\bin', localAppData: '', platform: 'win32', home: 'H:\\.codex' };

test('AGENT_ENGINE 选 agent：不填是 claude，大小写和空白都认', () => {
  assert.equal(agentOf({}), 'claude');
  assert.equal(agentOf({ AGENT_ENGINE: 'codex' }), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: ' Codex ' }), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: '请填要用的agent（可留空默认claude）' }), 'claude');
});

test('Claude 就绪：报名字和模型，没有问题', () => {
  assert.deepEqual(agentHealth({ CLAUDE_MODEL: 'opus' }, claudeOptions),
    { agent: 'claude', agentName: 'Claude', agentReady: true, agentModel: 'opus', agentProblem: null });
});

test('Claude 没配好：分别说没装和没登录，不报路径，不叫用户填令牌', () => {
  const noCli = agentHealth({}, { ...claudeOptions, path: '' });
  assert.equal(noCli.agentReady, false);
  assert.match(noCli.agentProblem, /本机 Claude 没配好.*装 Claude Code.*CLAUDE_CLI/);
  const noLogin = agentHealth({ CLAUDE_CODE_OAUTH_TOKEN: 'tok' }, { ...claudeOptions, exists: file => file === 'C:\\bin\\claude.exe' });
  assert.equal(noLogin.agentReady, false);
  assert.match(noLogin.agentProblem, /本机 Claude 没配好.*运行 claude.*自己的.*账号登录/);
  for (const health of [noCli, noLogin]) assert.doesNotMatch(health.agentProblem, /setup-token|令牌|C:\\/);
});

test('Codex 就绪：不用令牌，只看命令行和登录', () => {
  assert.deepEqual(agentHealth({ AGENT_ENGINE: 'codex' }, codexOptions),
    { agent: 'codex', agentName: 'Codex', agentReady: true, agentModel: '默认', agentProblem: null });
});

test('Codex 缺东西：分别说没装和没登录', () => {
  assert.match(agentHealth({ AGENT_ENGINE: 'codex' }, { ...codexOptions, path: '' }).agentProblem, /本机 Codex 没配好.*CODEX_CLI/);
  const noLogin = { ...codexOptions, exists: file => file === 'C:\\bin\\codex.exe' };
  assert.match(agentHealth({ AGENT_ENGINE: 'codex' }, noLogin).agentProblem, /本机 Codex 没配好.*codex login/);
});

test('填了不认识的 agent：不就绪、原话报错，不偷偷换成 Claude', () => {
  const health = agentHealth({ AGENT_ENGINE: 'gemini' }, claudeOptions);
  assert.equal(health.agentReady, false);
  assert.match(health.agentProblem, /AGENT_ENGINE.*gemini/);
  assert.throws(() => createAgentCall({ env: { AGENT_ENGINE: 'gemini' }, tmpRoot: tempDir() }), /AGENT_ENGINE/);
});

test('调用入口按 AGENT_ENGINE 分路：选 codex 启动 codex，不碰 claude', async () => {
  let started = '';
  const launch = file => {
    started = file;
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
    child.stdin = new EventEmitter();
    child.stdin.end = () => setImmediate(() => {
      child.stdout.emit('data', `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })}\n${JSON.stringify({ type: 'turn.completed', usage: {} })}`);
      child.emit('close', 0);
    });
    return child;
  };
  const call = createAgentCall({ env: { AGENT_ENGINE: 'codex', CODEX_CLI: 'C:\\x\\codex.exe' }, tmpRoot: tempDir(), launch, findCli: () => 'C:\\x\\codex.exe' });
  assert.equal((await call({ system: 's', prompt: 'p' })).text, 'ok');
  assert.equal(started, 'C:\\x\\codex.exe');
});
