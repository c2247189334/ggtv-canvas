// 本机 agent 的通用入口：拆解、看图、看图定稿、帮我改写都走这里。
// 用谁：.env.local 的 AGENT_ENGINE（页面「设置」里也能点选）。不填或填 auto 就自动选——Claude 装好并登录了用 Claude，否则 Codex 好了用 Codex（11-17 用户定）。
// 加新的 agent：写一个和 codex.mjs 一样的适配文件 —— call({ system, prompt, files, model, timeoutMs }) → { text, model, elapsedMs, usage } —— 再在 AGENTS 里加一项。
import { CLAUDE_LOGIN_HINT, claudeHealth, createClaudeCall } from './claude.mjs';
import { strengthOf } from './agentStrength.mjs';
import { CODEX_LOGIN_HINT, codexHealth, createCodexCall } from './codex.mjs';
import { configured } from './config.mjs';

const AGENTS = {
  claude: { name: 'Claude', create: createClaudeCall, health(env, options) {
    const { claudeReady, claudeCli, claudeLogin, claudeModel } = claudeHealth(env, options);
    return { ready: claudeReady, cli: claudeCli, login: claudeLogin, model: claudeModel, fix: claudeCli ? CLAUDE_LOGIN_HINT : '装 Claude Code（或 Claude 桌面版），或在 .env.local 填 CLAUDE_CLI（要 claude.exe 的完整路径，npm 装出来的 claude.cmd 用不了）' };
  } },
  codex: { name: 'Codex', create: createCodexCall, health(env, options) {
    const { ready, cli, login, model } = codexHealth(env, options);
    return { ready, cli, login, model, fix: cli ? CODEX_LOGIN_HINT :'装 Codex（桌面版或命令行），或在 .env.local 填 CODEX_CLI（要 codex.exe 的完整路径，npm 装出来的 codex.cmd 用不了）' };
  } },
};
const AUTO = 'auto';
/** 设置面板能选的：自动，或指定某一个。 */
export const AGENT_CHOICES = Object.freeze([AUTO, ...Object.keys(AGENTS)]);

/** 用户选的是什么：不填就是自动。 */
function choiceOf(env) {
  return (configured(env, 'AGENT_ENGINE') || AUTO).toLowerCase();
}

/** 这次用谁。自动时挑第一个装好并登录的；都没好按 claude 报（提示里会说 Codex 也行）。明确指定的不偷换。 */
export function agentOf(env, options) {
  const choice = choiceOf(env);
  if (choice !== AUTO) return choice;
  return Object.keys(AGENTS).find(id => AGENTS[id].health(env, options).ready) ?? 'claude';
}

/** 设置面板「本机 AI 助手」一栏用：选的是自动还是指定、写词强度哪一档（只管 Claude）、每个助手装没装登没登录。不报路径和令牌。 */
export function agentSettings(env, options) {
  return { agentChoice: choiceOf(env), agentStrength: strengthOf(env), agents: Object.entries(AGENTS).map(([id, { name, health }]) => {
    const { cli, login, ready } = health(env, options);
    return { id, name, cli, login, ready };
  }) };
}

/** 设置面板和页面用：用的是谁、好没好、缺什么。不报路径和令牌。 */
export function agentHealth(env, options) {
  const agent = agentOf(env, options);
  if (!Object.hasOwn(AGENTS, agent)) {
    return { agent, agentName: agent, agentReady: false, agentModel: '', agentProblem: `.env.local 的 AGENT_ENGINE 只能填 ${Object.keys(AGENTS).join(' 或 ')}，现在填的是「${agent}」。` };
  }
  const { name } = AGENTS[agent], { ready, model, fix } = AGENTS[agent].health(env, options);
  const other = choiceOf(env) === AUTO ? '也可以改用 Codex：装好并登录后会自动认到。' : '';
  return { agent, agentName: name, agentReady: ready, agentModel: model, agentProblem: ready ? null : `本机 ${name} 没配好：${fix}。${other}` };
}

/** 拆解、看图、写提示词、帮我改写都要本机 agent（11-15 用户定，不再用豆包）：没配好就在动手之前拦下，原话说清这一步要它干嘛。 */
export function agentNeeded(env, options) {
  const { agentReady, agentProblem } = agentHealth(env, options);
  return agentReady ? null : `这一步要用你电脑上的 Claude 或 Codex（帮你看视频和图片、写提示词，不花火山的钱），现在用不了。${agentProblem}`;
}

export function createAgentCall(options) {
  const agent = agentOf(options.env);
  if (!Object.hasOwn(AGENTS, agent)) throw Error(agentHealth(options.env).agentProblem);
  return AGENTS[agent].create(options);
}
