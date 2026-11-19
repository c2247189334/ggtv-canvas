import { describe, expect, it } from "vitest";
import type { Health } from "@/types";
import { agentOptions, loginTargets } from "./agentChoice";

// 11-17 用户定：本机 AI 助手用谁在设置里点选，不用手改 .env.local；每个助手装没装、登没登录要说人话。
const base: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0 };
const claude = { id: "claude", name: "Claude", cli: true, login: true, ready: true };
const codex = { id: "codex", name: "Codex", cli: true, login: false, ready: false };

describe("agentOptions", () => {
  it("第一项是自动，写明现在会用谁；后面每个助手一项", () => {
    const options = agentOptions({ ...base, agentChoice: "auto", agents: [claude, codex] });
    expect(options.map(option => option.id)).toEqual(["auto", "claude", "codex"]);
    expect(options[0]).toMatchObject({ label: "自动", ready: true, hint: null });
    expect(options[0].state).toBe("哪个装好并登录了就用哪个，现在会用 Claude");
    expect(options[1]).toMatchObject({ label: "Claude", state: "已装好、已登录，能用", ready: true, hint: null });
  });

  // 11-19 用户实测：照「去终端敲 codex login」做，报「不是内部或外部命令」（桌面版自带的那份不在 PATH 里）。改成点登录按钮。
  it("装了没登录：叫人点下面的登录按钮、登好自己会变能用；不叫人去终端敲命令、不叫人填令牌", () => {
    const [, , row] = agentOptions({ ...base, agentChoice: "auto", agents: [claude, codex] });
    expect(row.state).toBe("已装好，还没登录");
    expect(row.hint).toBe("点下面「登录 Codex」，会弹出官方登录窗口和浏览器登录页，用你自己的账号登录；登好了这里自己会变成能用。");
    expect(row.hint).not.toMatch(/终端|codex login|令牌|token/i);
  });

  it("没装：说装什么，npm 装出来的认不到；「自动」一个都不能用时说点登录，或者先装", () => {
    const [auto, row] = agentOptions({ ...base, agentChoice: "auto", agents: [{ ...claude, cli: false, login: true, ready: false }, codex] });
    expect(row.state).toBe("没装");
    expect(row.hint).toContain("claude.exe");
    expect(auto.ready).toBe(false);
    expect(auto.state).toBe("哪个装好并登录了就用哪个，现在两个都还不能用");
    expect(auto.hint).toBe("点下面的登录按钮，登好一个就能用。");
    const none = agentOptions({ ...base, agentChoice: "auto", agents: [{ ...claude, cli: false, login: false, ready: false }, { ...codex, cli: false }] })[0];
    expect(none.hint).toContain("先装好 Claude Code（或 Claude 桌面版）或者 Codex 桌面版");
  });

  it("小服务没报助手清单（旧版小服务）就给空清单，页面不画这一栏", () => {
    expect(agentOptions(base)).toEqual([]);
  });
});

describe("loginTargets", () => {
  const ids = (patch: Partial<Health>) => loginTargets({ ...base, ...patch }).map(agent => agent.id);
  it("选了谁、谁装了没登录，就给谁登录按钮；登好的、没装的不给", () => {
    expect(ids({ agentChoice: "codex", agents: [claude, codex] })).toEqual(["codex"]);
    expect(ids({ agentChoice: "claude", agents: [claude, codex] })).toEqual([]);
    expect(ids({ agentChoice: "codex", agents: [claude, { ...codex, cli: false }] })).toEqual([]);
  });
  it("选「自动」：已经有能用的就不打扰；一个都不能用时，装好的都给按钮", () => {
    expect(ids({ agentChoice: "auto", agents: [claude, codex] })).toEqual([]);
    const claudeOut = { ...claude, login: false, ready: false };
    expect(ids({ agentChoice: "auto", agents: [claudeOut, codex] })).toEqual(["claude", "codex"]);
    expect(ids({ agents: [claudeOut, { ...codex, cli: false }] })).toEqual(["claude"]);
    expect(ids({})).toEqual([]);
  });
});
