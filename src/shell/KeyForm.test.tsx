import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { HealthDetails } from "./SettingsButton";
import { KeyForm, savedMessage } from "./KeyForm";

const health = (patch: Partial<Health>) => ({ ok: true, fake: false, keyReady: false, tosReady: false, todayYuan: 0, uncertainToday: 0, ...patch }) as Health;

it("设置里能填 Key：4 个框，密钥框是密码框，没填写「没填」、填过写「已填（不显示）」，从不带值", () => {
  const empty = renderToStaticMarkup(<KeyForm health={health({})} onSaved={() => {}} />);
  expect(empty.match(/<input/g)).toHaveLength(4);
  expect(empty.match(/type="password"/g)).toHaveLength(3);
  expect(empty.match(/placeholder="没填"/g)).toHaveLength(4);
  expect(empty).toMatch(/<button type="submit" disabled="">保存<\/button>/);
  expect(empty).toContain(".env.local");
  const ready = renderToStaticMarkup(<KeyForm health={health({ keyReady: true, tosReady: true })} onSaved={() => {}} />);
  expect(ready.match(/placeholder="已填（不显示）"/g)).toHaveLength(4);
  expect(ready.match(/value=""/g)).toHaveLength(4);
});

it("没填 Key 时说清哪些照常能用，不再叫人去改 .env.local", () => {
  const html = renderToStaticMarkup(<HealthDetails health={health({})} />);
  expect(html).toContain("没填 Key 也能先用画布、上传、剪辑；出图、出视频那一步才要。");
  expect(html).not.toContain("ARK_API_KEY= 后面");
  expect(renderToStaticMarkup(<HealthDetails health={health({ keyReady: true })} />)).not.toContain("没填 Key 也能");
});

// 11-17 用户定：设置里要教怎么拿 Key；保存时顺手验一下，填错当场说。
it("怎么拿 Key：没填时默认展开，四步带火山官方网址；填好了收起来", () => {
  const empty = renderToStaticMarkup(<KeyForm health={health({})} onSaved={() => {}} />);
  expect(empty).toMatch(/<details class="keys__guide" open="">/);
  for (const text of ["怎么拿 Key", "https://console.volcengine.com/", "https://ark.volcengine.com/region:cn-beijing/apikey", "创建 API Key", "开通管理", "Seedream", "Seedance", "拿视频当参考出片"]) expect(empty).toContain(text);
  expect(empty.match(/target="_blank" rel="noreferrer"/g)).toHaveLength(3);
  expect(renderToStaticMarkup(<KeyForm health={health({ keyReady: true })} onSaved={() => {}} />)).toMatch(/<details class="keys__guide">/);
});

it("保存后的话：火山认了说认了，回 401 标红叫重新填，没连上说没法验，没验就不提", () => {
  expect(savedMessage({ saved: ["ARK_API_KEY"], tosReady: true, keyCheck: "accepted" })).toEqual({ ok: true, text: "已保存 1 项，不用重启。火山认这个 Key。" });
  const rejected = savedMessage({ saved: ["ARK_API_KEY"], tosReady: false, keyCheck: "rejected" });
  expect(rejected.ok).toBe(false); expect(rejected.text).toContain("火山说这个 Key 不对（401）"); expect(rejected.text).toContain("重新填");
  expect(savedMessage({ saved: ["ARK_API_KEY"], tosReady: false, keyCheck: "unknown" }).text).toBe("已保存 1 项，不用重启。这次没连上火山，没法验 Key 对不对，出图时就知道。TOS 三项还没填齐，只有带参考视频出片才要。");
  expect(savedMessage({ saved: ["TOS_BUCKET"], tosReady: false })).toEqual({ ok: true, text: "已保存 1 项，不用重启。TOS 三项还没填齐，只有带参考视频出片才要。" });
});

it("设置里是功能清单：缺的打叹号并说怎么办，选装的收在折叠里，不再摆变量名", () => {
  const html = renderToStaticMarkup(<HealthDetails health={health({ ffmpegFound: false, agentReady: false, agentProblem: "本机 Claude 没配好。" })} />);
  expect(html).toContain("<b>出图、出视频</b>：还不能用，缺 火山 Key");
  expect(html).toContain("winget install Gyan.FFmpeg");
  expect(html).toMatch(/<details class="features__optional"><summary>选装功能（不装不影响别的）：2 项没装<\/summary>/);
  expect(html).not.toMatch(/ARK_API_KEY|COMFYUI_DIR|CLAUDE_CLI/);
  const ok = renderToStaticMarkup(<HealthDetails health={health({ keyReady: true, tosReady: true })} />);
  expect(ok).toContain('<li class="features__row is-ok"><span class="features__mark" aria-hidden="true">✓</span><div><b>出图、出视频</b>：能用</div></li>');
});
