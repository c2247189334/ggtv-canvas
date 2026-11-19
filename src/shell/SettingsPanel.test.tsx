import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { clickedOutside } from "./SettingsButton";
import { SettingsPanel } from "./SettingsPanel";

// 11-19 用户定：一个面板里全搞定，不再点一项弹一个窗口；Key 填好了只打勾，要换再点「重新填」。
const health: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, ffmpegFound: true, ffprobeFound: true,
  agent: "claude", agentName: "Claude", agentReady: true, agentChoice: "auto", agentStrength: "standard",
  agents: [{ id: "claude", name: "Claude", cli: true, login: true, ready: true }, { id: "codex", name: "Codex", cli: true, login: false, ready: false }] };
const noop = () => {};
const panel = (patch: Partial<Health> = {}, opts: { keyRejected?: boolean; keyEditing?: boolean } = {}) =>
  renderToStaticMarkup(<SettingsPanel health={{ ...health, ...patch }} keyRejected={opts.keyRejected ?? false} keyEditing={opts.keyEditing ?? false} keyFocus={0}
    onKeyEditing={noop} onChanged={noop} onKeySaved={noop} />);

it("三块摆在同一个面板里：功能、火山 Key、本机 AI 助手（用谁 + 写词强度放一起），没有弹窗", () => {
  const html = panel();
  for (const text of ["<h3>功能</h3>", "5 项都能用", "<h3>火山 Key</h3>", "<h3>本机 AI 助手</h3>", "写词强度"]) expect(html).toContain(text);
  expect(html).not.toContain('role="dialog"');
  expect(html.match(/name="ggtv-agent"/g)).toHaveLength(3);
  expect(html.match(/name="ggtv-strength"/g)).toHaveLength(3);
});

it("每个功能一个小标签打勾；都好时不写一长串怎么办", () => {
  const html = panel();
  for (const name of ["出图、出视频", "拿视频当参考出片", "片段截取、视频截图、提取原声", "帮我改写", "视频改写、拆解"])
    expect(html).toContain(`<span class="features__mark" aria-hidden="true">✓</span>${name}</li>`);
  expect(html.split("features--optional")[0]).not.toContain("features__fixes");
});

it("Key 都填好了：只一行打勾 +「重新填」，不摆填写框", () => {
  const html = panel();
  expect(html).toContain("方舟 Key 已填"); expect(html).toContain("TOS 已填"); expect(html).toContain(">重新填</button>");
  expect(html).not.toContain("<input type=\"password\"");
  expect(html).not.toContain("for=\"key-ARK_API_KEY\"");
});

it("点了「重新填」才摊开填写框，旁边能收起", () => {
  const html = panel({}, { keyEditing: true });
  expect(html.match(/type="password"/g)).toHaveLength(3);
  expect(html).toContain(">收起</button>"); expect(html).not.toContain(">重新填</button>");
});

it("没填 Key、或火山说不对：直接摊开填写框，不给收起", () => {
  for (const html of [panel({ keyReady: false }), panel({}, { keyRejected: true })]) {
    expect(html.match(/type="password"/g)).toHaveLength(3);
    expect(html).not.toContain(">收起</button>");
    expect(html).toContain("2 项还不能用");
  }
  expect(panel({ keyReady: false })).toContain("没填 Key 也能先用画布、上传、剪辑；出图、出视频那一步才要。");
});

// 11-19 用户嫌功能那块把怎么登录又写一大段：下面助手那块已经写了，上面只打叹号。
it("选了没登录的 Codex：功能那块只打叹号不重复写怎么登录，助手那块有登录按钮", () => {
  const html = panel({ agentChoice: "codex", agent: "codex", agentName: "Codex", agentReady: false, agentProblem: "本机 Codex 没配好：点右上角「设置」……" });
  expect(html).toContain("2 项还不能用");
  expect(html).toContain('<span class="features__mark" aria-hidden="true">!</span>帮我改写</li>');
  expect(html).not.toContain("<b>帮我改写</b>");
  expect(html).not.toContain("<b>视频改写、拆解</b>");
  expect(html).toContain('<button type="button">登录 Codex</button>');
  // 同时缺 ffmpeg：「视频改写、拆解」还要写 ffmpeg 怎么装，照常写出来。
  expect(panel({ agentChoice: "codex", agent: "codex", agentReady: false, ffmpegFound: false })).toContain("<b>视频改写、拆解</b>");
});

it("假火山模式：说是假图免费，不画本机助手，Key 不摊开", () => {
  const html = panel({ fake: true, keyReady: false });
  expect(html).toContain("假火山模式");
  expect(html).not.toContain("本机 AI 助手</h3>");
  expect(html).not.toContain("type=\"password\"");
});

// 11-19 上传前审查：「?」气泡挂在 body 上、不在面板里，按下气泡里的「API Key 管理」等链接会被当成点外面，面板关了、没保存的字也丢了。
it("点外面才关面板：面板里不关，「?」浮出的气泡里也不关，别处才关", () => {
  const node = (inPanel: boolean, inBubble: boolean) => ({ inPanel, closest: (selector: string) => (selector === ".help-tip__bubble" && inBubble ? {} : null) });
  const panelEl = { contains: (target: unknown) => Boolean((target as { inPanel?: boolean } | null)?.inPanel) };
  expect(clickedOutside(node(true, false) as unknown as EventTarget, panelEl)).toBe(false);
  expect(clickedOutside(node(false, true) as unknown as EventTarget, panelEl)).toBe(false);
  expect(clickedOutside(node(false, false) as unknown as EventTarget, panelEl)).toBe(true);
  expect(clickedOutside(node(false, false) as unknown as EventTarget, null)).toBe(false);
});
