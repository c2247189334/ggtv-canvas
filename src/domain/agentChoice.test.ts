import { describe, expect, it } from "vitest";
import type { Health } from "@/types";
import { agentOptions } from "./agentChoice";

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

  it("装了没登录：说怎么登录，登录完点重新检查；不叫人填令牌", () => {
    const [, , row] = agentOptions({ ...base, agentChoice: "auto", agents: [claude, codex] });
    expect(row.state).toBe("已装好，还没登录");
    expect(row.hint).toContain("codex login");
    expect(row.hint).toContain("重新检查");
    expect(row.hint).not.toMatch(/令牌|token/i);
  });

  it("没装：说装什么，npm 装出来的认不到", () => {
    const [auto, row] = agentOptions({ ...base, agentChoice: "auto", agents: [{ ...claude, cli: false, login: true, ready: false }, codex] });
    expect(row.state).toBe("没装");
    expect(row.hint).toContain("claude.exe");
    expect(auto.ready).toBe(false);
    expect(auto.state).toBe("哪个装好并登录了就用哪个，现在两个都还不能用");
  });

  it("小服务没报助手清单（旧版小服务）就给空清单，页面不画这一栏", () => {
    expect(agentOptions(base)).toEqual([]);
  });
});
