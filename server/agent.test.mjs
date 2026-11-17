import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { join } from 'node:path';
import { agentHealth, agentOf, agentSettings, createAgentCall } from './agent.mjs';
import { tempDir } from './testKit.mjs';

const claudeHome = 'C:\\U\\.claude';
const claudeOptions = { exists: file => file === 'C:\\bin\\claude.exe' || file === join(claudeHome, '.credentials.json'), path: 'C:\\bin', localAppData: '', platform: 'win32', home: claudeHome };
const codexOptions = { exists: file => file === 'C:\\bin\\codex.exe' || file.endsWith('auth.json'), path: 'C:\\bin', localAppData: '', platform: 'win32', home: 'H:\\.codex' };

test('AGENT_ENGINE 选 agent：不填是自动（都没装好时按 claude 报），大小写和空白都认', () => {
  const none = { ...claudeOptions, path: '' };
  assert.equal(agentOf({}, none), 'claude');
  assert.equal(agentOf({ AGENT_ENGINE: 'codex' }), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: ' Codex ' }), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: '请填要用的agent（可留空默认claude）' }, none), 'claude');
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

// 11-17 用户定：新手多半让 AI 助手装，电脑上有哪个助手就该直接用哪个，不用手改 .env.local。
test('没指定就自动选：Claude 就绪用 Claude，否则 Codex 就绪用 Codex；填 auto 和不填一样；明确指定的不偷换', () => {
  assert.equal(agentOf({}, claudeOptions), 'claude');
  assert.equal(agentOf({}, codexOptions), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: ' Auto ' }, codexOptions), 'codex');
  assert.equal(agentOf({ AGENT_ENGINE: 'claude' }, codexOptions), 'claude');
  const auto = agentHealth({}, codexOptions);
  assert.equal(auto.agentName, 'Codex'); assert.equal(auto.agentReady, true); assert.equal(auto.agentProblem, null);
  assert.match(agentHealth({}, { ...claudeOptions, path: '' }).agentProblem, /本机 Claude 没配好.*也可以改用 Codex：装好并登录后会自动认到/);
  assert.doesNotMatch(agentHealth({ AGENT_ENGINE: 'claude' }, codexOptions).agentProblem, /也可以改用 Codex/);
});

test('设置面板用的清单：选的是自动还是指定、每个助手装没装登没登录；不带路径', () => {
  assert.deepEqual(agentSettings({}, codexOptions), { agentChoice: 'auto', agents: [
    { id: 'claude', name: 'Claude', cli: false, login: false, ready: false },
    { id: 'codex', name: 'Codex', cli: true, login: true, ready: true }] });
  assert.equal(agentSettings({ AGENT_ENGINE: ' Codex ' }, claudeOptions).agentChoice, 'codex');
  assert.equal(agentSettings({ AGENT_ENGINE: 'gemini' }, claudeOptions).agentChoice, 'gemini');
  assert.doesNotMatch(JSON.stringify(agentSettings({}, claudeOptions)), /C:\\|bin/);
});
