import type { AgentState, Health } from "@/types";

/**
 * 设置面板「本机 AI 助手」一栏的每一行（11-17 用户定：用谁在页面里点选，不用手改 .env.local）。
 * 登录只能在助手自己的官方窗口里做，这里只说去哪登录，不收账号密码、不收令牌。
 */
export type AgentOption = { id: string; label: string; state: string; ready: boolean; hint: string | null };

const AFTER = "登录完回到这里点「重新检查」。";
const LOGIN: Record<string, string> = {
  claude: `按 Win 键搜「终端」打开，输入 claude 回车，按提示用你自己的 Claude 账号登录。${AFTER}`,
  codex: `按 Win 键搜「终端」打开，输入 codex login 回车，按提示用你自己的账号登录。${AFTER}`
};
const INSTALL: Record<string, string> = {
  claude: "先装 Claude Code 或 Claude 桌面版并登录（要的是 claude.exe，用 npm 装出来的认不到）。装完点「重新检查」，还认不到就关掉黑窗口重新双击「一键启动.bat」。",
  codex: "先装 Codex 桌面版或命令行并登录（要的是 codex.exe，用 npm 装出来的认不到）。装完点「重新检查」，还认不到就关掉黑窗口重新双击「一键启动.bat」。"
};

function agentRow(agent: AgentState): AgentOption {
  const row = { id: agent.id, label: agent.name, ready: agent.ready };
  if (agent.ready) return { ...row, state: "已装好、已登录，能用", hint: null };
  if (agent.cli) return { ...row, state: "已装好，还没登录", hint: LOGIN[agent.id] ?? `用你自己的账号在 ${agent.name} 里登录一次。${AFTER}` };
  return { ...row, state: "没装", hint: INSTALL[agent.id] ?? `先装好 ${agent.name} 并登录。` };
}

/** 第一项是「自动」，后面每个助手一项。小服务没报清单（旧版）就返回空。 */
export function agentOptions(health: Health): AgentOption[] {
  const agents = health.agents ?? [];
  if (!agents.length) return [];
  const first = agents.find(agent => agent.ready);
  return [{ id: "auto", label: "自动", ready: Boolean(first), hint: null,
    state: `哪个装好并登录了就用哪个，现在${first ? `会用 ${first.name}` : "两个都还不能用"}` }, ...agents.map(agentRow)];
}
