// 本机 agent 的通用入口：拆解、看图、看图定稿、帮我改写都走这里，.env.local 的 AGENT_ENGINE 选用谁（默认 claude）。
// 加新的 agent：写一个和 codex.mjs 一样的适配文件 —— call({ system, prompt, files, model, timeoutMs }) → { text, model, elapsedMs, usage } —— 再在 AGENTS 里加一项。
import { CLAUDE_LOGIN_HINT, claudeHealth, createClaudeCall } from './claude.mjs';
import { codexHealth, createCodexCall } from './codex.mjs';
import { configured } from './config.mjs';

const AGENTS = {
  claude: { name: 'Claude', create: createClaudeCall, health(env, options) {
    const { claudeReady, claudeCli, claudeModel } = claudeHealth(env, options);
    return { ready: claudeReady, model: claudeModel, fix: claudeCli ? CLAUDE_LOGIN_HINT : '装 Claude Code（或 Claude 桌面版），或在 .env.local 填 CLAUDE_CLI（要 claude.exe 的完整路径，npm 装出来的 claude.cmd 用不了）' };
  } },
  codex: { name: 'Codex', create: createCodexCall, health(env, options) {
    const { ready, cli, model } = codexHealth(env, options);
    return { ready, model, fix: cli ? '在终端跑一次 codex login' : '装 Codex（桌面版或命令行），或在 .env.local 填 CODEX_CLI（要 codex.exe 的完整路径，npm 装出来的 codex.cmd 用不了）' };
  } },
};

export function agentOf(env) {
  return (configured(env, 'AGENT_ENGINE') || 'claude').toLowerCase();
}

/** 设置面板和页面用：用的是谁、好没好、缺什么。不报路径和令牌。 */
export function agentHealth(env, options) {
  const agent = agentOf(env);
  if (!Object.hasOwn(AGENTS, agent)) {
    return { agent, agentName: agent, agentReady: false, agentModel: '', agentProblem: `.env.local 的 AGENT_ENGINE 只能填 ${Object.keys(AGENTS).join(' 或 ')}，现在填的是「${agent}」。` };
  }
  const { name } = AGENTS[agent], { ready, model, fix } = AGENTS[agent].health(env, options);
  return { agent, agentName: name, agentReady: ready, agentModel: model, agentProblem: ready ? null : `本机 ${name} 没配好：${fix}。` };
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
