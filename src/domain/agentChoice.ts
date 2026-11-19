import type { AgentState, Health } from "@/types";

/**
 * 设置面板「本机 AI 助手」一栏的每一行（11-17 用户定：用谁在页面里点选，不用手改 .env.local）。
 * 登录只能在助手自己的官方窗口里做：11-19 起点「登录 X」由小服务打开官方登录窗口，这里不收账号密码、不收令牌。
 * 别再叫人去终端敲 claude / codex login：桌面版自带的那份不在 PATH 里，敲了报「不是内部或外部命令」（11-19 用户实测）。
 */
export type AgentOption = { id: string; label: string; state: string; ready: boolean; hint: string | null };

const LOGIN = (name: string) => `点下面「登录 ${name}」，会弹出官方登录窗口和浏览器登录页，用你自己的账号登录；登好了这里自己会变成能用。`;
const INSTALL: Record<string, string> = {
  claude: "先装 Claude Code 或 Claude 桌面版并登录（要的是 claude.exe，用 npm 装出来的认不到）。装完点「重新检查」，还认不到就关掉黑窗口重新双击「一键启动.bat」。",
  codex: "先装 Codex 桌面版或命令行并登录（要的是 codex.exe，用 npm 装出来的认不到）。装完点「重新检查」，还认不到就关掉黑窗口重新双击「一键启动.bat」。"
};

function agentRow(agent: AgentState): AgentOption {
  const row = { id: agent.id, label: agent.name, ready: agent.ready };
  if (agent.ready) return { ...row, state: "已装好、已登录，能用", hint: null };
  if (agent.cli) return { ...row, state: "已装好，还没登录", hint: LOGIN(agent.name) };
  return { ...row, state: "没装", hint: INSTALL[agent.id] ?? `先装好 ${agent.name} 并登录。` };
}

/** 第一项是「自动」，后面每个助手一项。小服务没报清单（旧版）就返回空。 */
export function agentOptions(health: Health): AgentOption[] {
  const agents = health.agents ?? [];
  if (!agents.length) return [];
  const first = agents.find(agent => agent.ready);
  return [{ id: "auto", label: "自动", ready: Boolean(first), hint: first ? null : agents.some(agent => agent.cli) ? "点下面的登录按钮，登好一个就能用。"
      : "先装好 Claude Code（或 Claude 桌面版）或者 Codex 桌面版，装完点「重新检查」，再回来登录。只出图、出视频用不到它。",
    state: `哪个装好并登录了就用哪个，现在${first ? `会用 ${first.name}` : "两个都还不能用"}` }, ...agents.map(agentRow)];
}

/**
 * 要露「登录」按钮的助手：装好了没登录的才有；选了谁就只给谁，选「自动」又一个都不能用时给所有装好的。
 * 选「自动」已经有能用的，就不打扰（另一个没登录也没关系）。
 */
export function loginTargets(health: Health): AgentState[] {
  const agents = health.agents ?? [];
  const choice = health.agentChoice ?? "auto";
  const anyReady = agents.some(agent => agent.ready);
  return agents.filter(agent => agent.cli && !agent.login && (choice === agent.id || (choice === "auto" && !anyReady)));
}
