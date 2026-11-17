import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { AgentPicker, saveChoice } from "./AgentPicker";

// 11-17 用户定：本机 AI 助手用谁在设置里点选，点了立刻保存生效。
const health: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, agentChoice: "auto",
  agent: "claude", agentName: "Claude", agentReady: true, agents: [
    { id: "claude", name: "Claude", cli: true, login: true, ready: true },
    { id: "codex", name: "Codex", cli: true, login: false, ready: false }] };
const html = (patch: Partial<Health> = {}) => renderToStaticMarkup(<AgentPicker health={{ ...health, ...patch }} onChanged={() => {}} />);

it("列出自动、Claude、Codex 三项和各自的情况，现在选的那项是勾着的，带「重新检查」", () => {
  const auto = html();
  expect(auto.match(/type="radio"/g)).toHaveLength(3);
  expect(auto.match(/checked=""/g)).toHaveLength(1);
  expect(auto).toMatch(/checked=""[^>]*\/><div><b>自动<\/b>/);
  for (const text of ["本机 AI 助手用谁", "现在会用 Claude", "已装好、已登录，能用", "已装好，还没登录", "codex login", "重新检查", "不花火山的钱"]) expect(auto).toContain(text);
  expect(html({ agentChoice: "codex" })).toMatch(/checked=""[^>]*\/><div><b>Codex<\/b>/);
});

it("配置里填了不认识的名字：哪项都不勾，把原话显示出来并说点一下就能改回来", () => {
  const odd = html({ agentChoice: "gemini", agentProblem: ".env.local 的 AGENT_ENGINE 只能填 claude 或 codex，现在填的是「gemini」。" });
  expect(odd).not.toContain('checked=""');
  expect(odd).toContain("现在填的是「gemini」。点上面任意一项就能改回来。");
});

it("保存选择：成了回 null，没成回给人看的原话", async () => {
  const save = vi.fn().mockResolvedValue({});
  expect(await saveChoice("codex", save)).toBeNull();
  expect(save).toHaveBeenCalledWith("codex");
  expect(await saveChoice("claude", async () => { throw new Error("写 .env.local 失败"); })).toBe("写 .env.local 失败");
});

it("假火山模式、或小服务没报助手清单时不画这一栏", () => {
  expect(html({ fake: true })).toBe("");
  expect(html({ agents: undefined })).toBe("");
});
