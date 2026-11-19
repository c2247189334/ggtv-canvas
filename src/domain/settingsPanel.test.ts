import { expect, it } from "vitest";
import type { Health } from "@/types";
import { featureSummary, keyStatus, mustFillKey, showAgent, showStrength } from "./settingsPanel";

// 11-19 用户定：设置一个面板里全搞定；Key 填好了只打勾，要换再点「重新填」。
const ready: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, ffmpegFound: true, ffprobeFound: true,
  agent: "claude", agentName: "Claude", agentReady: true, agentChoice: "auto", agentStrength: "max",
  agents: [{ id: "claude", name: "Claude", cli: true, login: true, ready: true }] };

it("功能那块右上角：都好说几项都能用，缺了说几项还不能用", () => {
  expect(featureSummary(ready)).toEqual({ ok: true, text: "5 项都能用" });
  expect(featureSummary({ ...ready, keyReady: false })).toEqual({ ok: false, text: "2 项还不能用" });
  expect(featureSummary(ready, true)).toEqual({ ok: false, text: "2 项还不能用" });
});

it("Key 填填写框要不要摊开：只有真模式下没填、或火山说不对才摊开", () => {
  expect(mustFillKey(ready)).toBe(false);
  expect(mustFillKey({ ...ready, tosReady: false })).toBe(false);
  expect(mustFillKey({ ...ready, keyReady: false })).toBe(true);
  expect(mustFillKey(ready, true)).toBe(true);
  expect(mustFillKey({ ...ready, fake: true, keyReady: false })).toBe(false);
});

it("Key 收起那行：每项打勾或说缺什么，TOS 没填说只有参考视频才要", () => {
  expect(keyStatus(ready)).toEqual([{ name: "方舟 Key", ok: true, note: "已填" }, { name: "TOS", ok: true, note: "已填" }]);
  expect(keyStatus({ ...ready, tosReady: false })[1]).toEqual({ name: "TOS", ok: false, note: "没填（只有拿视频当参考出片才要）" });
  expect(keyStatus(ready, true)[0]).toEqual({ name: "方舟 Key", ok: false, note: "火山说不对" });
});

it("假火山模式、或小服务没报（旧版）：不画本机助手和强度", () => {
  expect([showAgent(ready), showStrength(ready)]).toEqual([true, true]);
  expect([showAgent({ ...ready, fake: true }), showStrength({ ...ready, fake: true })]).toEqual([false, false]);
  expect([showAgent({ ...ready, agents: undefined }), showStrength({ ...ready, agentStrength: undefined })]).toEqual([false, false]);
});
