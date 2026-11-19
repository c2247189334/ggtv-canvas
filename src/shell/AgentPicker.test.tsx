import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { AgentPicker, saveChoice, saveStrength } from "./AgentPicker";

// 11-17 用户定：本机 AI 助手用谁在设置里点选，点了立刻保存生效。
// 11-19 用户定：写词强度和用谁放在同一块，标准 Sonnet / 更强 Opus + 中等 / 最强 Opus + XHigh。
const health: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, agentChoice: "auto",
  agent: "claude", agentName: "Claude", agentReady: true, agentStrength: "standard", agents: [
    { id: "claude", name: "Claude", cli: true, login: true, ready: true },
    { id: "codex", name: "Codex", cli: true, login: false, ready: false }] };
const html = (patch: Partial<Health> = {}) => renderToStaticMarkup(<AgentPicker health={{ ...health, ...patch }} onChanged={() => {}} />);
const onLabel = (page: string, name: string) => page.match(new RegExp(`<label class="seg__item is-on"><input type="radio" name="${name}" checked=""[^>]*/><span>([^<]+)</span>`))?.[1];

it("用谁：自动、Claude、Codex 一排，选中的亮着，每个按钮下面一行小字说能不能用；能用就不再多写一句", () => {
  const auto = html();
  expect(auto.match(/name="ggtv-agent"/g)).toHaveLength(3);
  expect(onLabel(auto, "ggtv-agent")).toBe("自动");
  for (const text of ["<span>自动</span><small>用 Claude</small>", "<span>Claude</span><small>✓ 能用</small>", "<span>Codex</span><small>没登录</small>", "重新检查", "不花火山的钱"]) expect(auto).toContain(text);
  expect(auto).not.toContain("已装好、已登录，能用");
  expect(html({ agentChoice: "claude" })).not.toContain("已装好、已登录，能用");
});

it("选了还不能用的：下面说缺什么、点哪个按钮登录；都不能用时「自动」下面写都不能用", () => {
  const codex = html({ agentChoice: "codex" });
  expect(onLabel(codex, "ggtv-agent")).toBe("Codex");
  expect(codex).toContain("Codex：已装好，还没登录。点下面「登录 Codex」，会弹出官方登录窗口");
  expect(codex).toContain('<button type="button">登录 Codex</button>');
  expect(codex).not.toMatch(/终端|codex login/);
  const none = html({ agents: [{ id: "claude", name: "Claude", cli: false, login: false, ready: false }] });
  expect(none).toContain("<span>自动</span><small>都不能用</small>");
  expect(none).toContain("自动：哪个装好并登录了就用哪个，现在两个都还不能用");
});

it("写词强度：三档一排，现在那档亮着，下面一句说这档是什么", () => {
  const page = html();
  expect(page.match(/name="ggtv-strength"/g)).toHaveLength(3);
  expect(onLabel(page, "ggtv-strength")).toBe("标准");
  expect(page).toContain("标准：Sonnet，快、省额度（默认）。");
  expect(onLabel(html({ agentStrength: "max" }), "ggtv-strength")).toBe("最强");
  expect(html({ agentStrength: "max" })).toContain("Opus + XHigh 思考强度");
});

it("现在用 Codex：强度那排变灰点不了，说只对 Claude 生效；手填的组合哪档都不亮", () => {
  const codex = html({ agent: "codex", agentName: "Codex" });
  expect(codex).toContain('class="setp__strength is-off"');
  expect(codex.match(/<input type="radio" disabled="" name="ggtv-strength"/g)).toHaveLength(3);
  expect(html().match(/disabled=""/g)).toBeNull();
  expect(codex).toContain("现在用的是 Codex，写词强度只对 Claude 生效。");
  const custom = html({ agentStrength: "custom" });
  expect(onLabel(custom, "ggtv-strength")).toBeUndefined();
  expect(custom).toContain("手填的组合");
});

it("配置里填了不认识的名字：哪项都不亮，把原话显示出来并说点一下就能改回来", () => {
  const odd = html({ agentChoice: "gemini", agentProblem: ".env.local 的 AGENT_ENGINE 只能填 claude 或 codex，现在填的是「gemini」。" });
  expect(onLabel(odd, "ggtv-agent")).toBeUndefined();
  expect(odd).toContain("现在填的是「gemini」。点上面任意一项就能改回来。");
});

it("保存选择：成了回 null，没成回给人看的原话", async () => {
  const save = vi.fn().mockResolvedValue({});
  expect(await saveChoice("codex", save)).toBeNull();
  expect(save).toHaveBeenCalledWith("codex");
  expect(await saveChoice("claude", async () => { throw new Error("写 .env.local 失败"); })).toBe("写 .env.local 失败");
  const strength = vi.fn().mockResolvedValue({});
  expect(await saveStrength("max", strength)).toBeNull();
  expect(strength).toHaveBeenCalledWith("max");
});

it("假火山模式、或小服务没报助手清单时不画这一块；没报强度时只不画强度", () => {
  expect(html({ fake: true })).toBe("");
  expect(html({ agents: undefined })).toBe("");
  expect(html({ agentStrength: undefined })).not.toContain("写词强度");
});
