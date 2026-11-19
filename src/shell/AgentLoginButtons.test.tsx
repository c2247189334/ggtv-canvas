import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { AgentLoginButtons, LOGIN_WAIT_MS, openLogin, waitStep } from "./AgentLoginButtons";

// 11-19 用户定：没登录的助手旁边一个「登录」按钮，点了弹官方登录窗口，登好了自己变能用，不用再点重新检查。
const claude = { id: "claude", name: "Claude", cli: true, login: true, ready: true };
const codex = { id: "codex", name: "Codex", cli: true, login: false, ready: false };
const health: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, agentChoice: "codex", agents: [claude, codex] };
const html = (patch: Partial<Health> = {}) => renderToStaticMarkup(<AgentLoginButtons health={{ ...health, ...patch }} onChanged={() => {}} />);

it("选了没登录的 Codex：露「登录 Codex」按钮；都能用、选的已登录时什么都不画", () => {
  expect(html()).toBe('<div class="setp__actions"><button type="button">登录 Codex</button></div>');
  expect(html({ agentChoice: "claude" })).toBe("");
  expect(html({ agentChoice: "auto" })).toBe("");
});

it("叫小服务开登录窗口：成了回 null，没成回原话", async () => {
  const open = vi.fn().mockResolvedValue({ opened: true });
  expect(await openLogin("codex", open)).toBeNull();
  expect(open).toHaveBeenCalledWith("codex");
  expect(await openLogin("codex", async () => { throw new Error("没找到本机的 Codex，先装好 Codex 再来登录。"); })).toBe("没找到本机的 Codex，先装好 Codex 再来登录。");
});

it("等登录：登好了就收工；没登好、没到 5 分钟接着看；过了 5 分钟停下", () => {
  const waiting = { id: "codex", name: "Codex", until: 1000 + LOGIN_WAIT_MS };
  expect(waitStep(waiting, health, 1000)).toBe("poll");
  expect(waitStep(waiting, health, 1000 + LOGIN_WAIT_MS)).toBe("timeout");
  expect(waitStep(waiting, { ...health, agents: [claude, { ...codex, login: true, ready: true }] }, 1000 + LOGIN_WAIT_MS)).toBe("done");
  expect(waitStep(waiting, { ...health, agents: undefined }, 1000)).toBe("poll");
  expect(LOGIN_WAIT_MS).toBe(5 * 60 * 1000);
});
