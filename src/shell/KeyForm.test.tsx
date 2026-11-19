import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Health } from "@/types";
import { HealthDetails } from "./HealthDetails";
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

// 11-17 用户定：设置里要教怎么拿 Key。11-19 用户定：给 TOS 网址、说清为什么填、钱是火山收的；
// 铺开太长，改成每栏旁边一个「?」，移上去才浮出（取代原来默认展开的「怎么拿 Key」折叠块）。
it("每栏旁边一个「?」：步骤和官方网址收在里面，不再铺开；字点了还是落到输入框", () => {
  const empty = renderToStaticMarkup(<KeyForm health={health({})} onSaved={() => {}} />);
  expect(empty).not.toContain("<details");
  expect(empty.match(/class="help-tip"/g)).toHaveLength(5);
  for (const name of ["ARK_API_KEY", "TOS_ACCESS_KEY_ID", "TOS_SECRET_ACCESS_KEY", "TOS_BUCKET"]) {
    expect(empty).toContain(`for="key-${name}"`); expect(empty).toContain(`id="key-${name}"`);
  }
  expect(empty).not.toMatch(/<label[^>]*>(?:(?!<\/label>).)*<button/);
  const tip = (label: string) => empty.split(`aria-label="${label}"`)[1].split("</button>")[0];
  const ark = tip("火山方舟 API Key（出图、出视频要用）怎么拿");
  for (const text of ['href="https://console.volcengine.com/"', 'href="https://ark.volcengine.com/region:cn-beijing/apikey"', "创建 API Key", "开通管理", "Seedream", "Seedance", "200 元"]) expect(ark).toContain(text);
  for (const label of ["Access Key ID怎么拿", "Secret Access Key怎么拿"]) {
    const keyTip = tip(label);
    for (const text of ['href="https://console.volcengine.com/tos"', "立即开通", 'href="https://console.volcengine.com/iam/keymanage/"', "Access Key（不是 API Key）"]) expect(keyTip).toContain(text);
  }
  for (const text of ['href="https://console.volcengine.com/tos"', "创建桶", "华北2（北京）"]) expect(tip("桶名（北京区）怎么拿")).toContain(text);
  const why = tip("TOS 是干嘛的");
  for (const text of ["火山只收视频网址", "24 小时有效的临时链接", "只出图、用文字或图片出视频用不到", "火山按用量收", "以官网为准"]) expect(why).toContain(text);
  expect(empty).toContain("可以先不填");
  expect(empty).toContain("费用是火山从你自己的账号直接扣，本工具免费，不加价、不抽成");
  expect(empty).toContain("鼠标移到每栏旁边的「?」上");
  // 方舟 3 个 + 两个 TOS 密钥各 2 个 + 桶名 1 个；「TOS 是干嘛的」里没有链接。
  expect(empty.match(/target="_blank" rel="noreferrer"/g)).toHaveLength(8);
  expect(renderToStaticMarkup(<KeyForm health={health({ keyReady: true })} onSaved={() => {}} />)).not.toContain("鼠标移到每栏旁边");
});

it("保存后的话：火山认了说认了，回 401 标红叫重新填，没连上说没法验，没验就不提", () => {
  expect(savedMessage({ saved: ["ARK_API_KEY"], tosReady: true, keyCheck: "accepted" })).toEqual({ ok: true, text: "已保存 1 项，不用重启。火山认这个 Key。" });
  const rejected = savedMessage({ saved: ["ARK_API_KEY"], tosReady: false, keyCheck: "rejected" });
  expect(rejected.ok).toBe(false); expect(rejected.text).toContain("火山说这个 Key 不对（401）"); expect(rejected.text).toContain("重新填");
  expect(savedMessage({ saved: ["ARK_API_KEY"], tosReady: false, keyCheck: "unknown" }).text).toBe("已保存 1 项，不用重启。这次没连上火山，没法验 Key 对不对，出图时就知道。TOS 三项还没填齐，只有带参考视频出片才要。");
  expect(savedMessage({ saved: ["TOS_BUCKET"], tosReady: false })).toEqual({ ok: true, text: "已保存 1 项，不用重启。TOS 三项还没填齐，只有带参考视频出片才要。" });
});

it("设置里是功能清单：缺的打叹号并说怎么办，选装的单独一排、怎么装收在折叠里，不再摆变量名", () => {
  const html = renderToStaticMarkup(<HealthDetails health={health({ ffmpegFound: false, agentReady: false, agentProblem: "本机 Claude 没配好。" })} />);
  expect(html).toContain('<li class="features__pill" title="还不能用，缺 火山 Key"><span class="features__mark" aria-hidden="true">!</span>出图、出视频</li>');
  // 没填 Key 时「火山 Key」那块直接摊开填写框，这里不再重复写「去下面填」；别的缺项照写怎么办。
  expect(html).not.toContain("<b>出图、出视频</b>：");
  expect(html).toContain("winget install Gyan.FFmpeg");
  expect(html).toContain("<b>帮我改写</b>：还不能用，缺 本机 AI 助手。本机 Claude 没配好。");
  const tos = renderToStaticMarkup(<HealthDetails health={health({ keyReady: true, ffmpegFound: true, agentReady: true })} />);
  expect(tos).toContain("<b>拿视频当参考出片</b>：还不能用，缺 TOS 三项。在下面「火山 Key」那块填好点保存");
  expect(renderToStaticMarkup(<HealthDetails health={health({ keyReady: true, tosReady: true })} keyRejected />)).not.toContain("<b>出图、出视频</b>：");
  expect(html).toContain("<li class=\"features__label\">选装</li>");
  expect(html).toContain("深度动作捕捉（没装）");
  expect(html).toMatch(/<details class="features__optional"><summary>选装的怎么装（不装不影响别的）<\/summary>/);
  expect(html).not.toMatch(/ARK_API_KEY|COMFYUI_DIR|CLAUDE_CLI/);
  const ok = renderToStaticMarkup(<HealthDetails health={health({ keyReady: true, tosReady: true, ffmpegFound: true, agentReady: true })} />);
  expect(ok).toContain('<li class="features__pill is-ok" title="能用"><span class="features__mark" aria-hidden="true">✓</span>出图、出视频</li>');
  expect(ok.split("features--optional")[0]).not.toContain("features__fixes");
});
