import { expect, it } from "vitest";
import { featureChecklist } from "./featureChecklist";
import type { Health } from "@/types";

const ready = { filled: true, found: true };
const full: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, ffmpegFound: true, ffprobeFound: true,
  agentName: "Claude", agentReady: true, agentModel: "sonnet", depth: { python: ready, modelDir: ready, extraPackages: ready },
  mesh: { ready: true, url: { filled: false, found: true }, directory: ready } };
const rows = (health: Health) => { const list = featureChecklist(health); return Object.fromEntries([...list.main, ...list.optional].map(row => [row.name, row])); };

// 11-17 用户定：设置面板改成功能清单——每行一个功能，能不能用、缺什么、怎么办；深度、白模是选装。
it("全配好：每行都能用、不带怎么办；AI 助手那两行写明是谁和模型；深度、白模在选装那组", () => {
  const list = featureChecklist(full);
  expect(list.main.map(row => row.name)).toEqual(["出图、出视频", "拿视频当参考出片", "片段截取、视频截图、提取原声", "帮我改写", "视频改写、拆解"]);
  expect(list.optional.map(row => row.name)).toEqual(["深度动作捕捉", "白模动作捕捉"]);
  for (const row of [...list.main, ...list.optional]) { expect(row.ok).toBe(true); expect(row.fix).toBeNull(); }
  expect(rows(full)["帮我改写"].state).toBe("能用（Claude，模型 sonnet）");
  expect(rows(full)["出图、出视频"].state).toBe("能用");
});

it("什么都没装的新电脑：每行说缺什么和怎么办，不出现变量名和 .env.local（深度那行括号里的除外）", () => {
  const bare = rows({ ok: true, fake: false, keyReady: false, tosReady: false, todayYuan: 0, uncertainToday: 0, ffmpegFound: false, ffprobeFound: false,
    agentReady: false, agentProblem: "本机 Claude 没配好：装 Claude Code。" });
  expect(bare["出图、出视频"]).toMatchObject({ ok: false, state: "还不能用，缺 火山 Key" });
  expect(bare["出图、出视频"].fix).toContain("怎么拿 Key");
  expect(bare["拿视频当参考出片"].state).toBe("还不能用，缺 火山 Key、TOS 三项");
  expect(bare["片段截取、视频截图、提取原声"].fix).toContain("winget install Gyan.FFmpeg");
  expect(bare["片段截取、视频截图、提取原声"].fix).toContain("重新双击「一键启动.bat」");
  expect(bare["帮我改写"].fix).toContain("本机 Claude 没配好：装 Claude Code。");
  expect(bare["帮我改写"].fix).toContain("只出图出视频不需要");
  expect(bare["视频改写、拆解"].state).toBe("还不能用，缺 本机 AI 助手、ffmpeg");
  expect(bare["深度动作捕捉"].fix).toContain("安装深度.bat");
  expect(bare["白模动作捕捉"].fix).toContain("检查白模环境.bat");
  for (const [name, row] of Object.entries(bare)) {
    expect(`${row.state}${row.fix}`, name).not.toMatch(/\.env\.local|ARK_API_KEY|TOS_ACCESS|COMFYUI_|CLAUDE_CLI/);
  }
});

it("只缺一样时只说那一样：填了 Key 没填 TOS、有 AI 助手没 ffmpeg、深度装好了但没 ffprobe", () => {
  expect(rows({ ...full, tosReady: false })["拿视频当参考出片"].state).toBe("还不能用，缺 TOS 三项");
  expect(rows({ ...full, tosReady: false })["出图、出视频"].ok).toBe(true);
  const noFfmpeg = rows({ ...full, ffmpegFound: false });
  expect(noFfmpeg["帮我改写"].ok).toBe(true);
  expect(noFfmpeg["视频改写、拆解"]).toMatchObject({ ok: false, state: "还不能用，缺 ffmpeg", fix: "ffmpeg 的装法见「片段截取」那一条。" });
  expect(rows({ ...full, ffprobeFound: false })["深度动作捕捉"].state).toBe("还不能用，缺 ffmpeg");
  expect(rows({ ...full, depth: { python: { filled: false, found: false }, modelDir: ready, extraPackages: ready } })["深度动作捕捉"].fix).toContain("DEPTH_PYTHON");
});

it("假火山模式：全部按能用算", () => {
  const list = featureChecklist({ ok: true, fake: true, keyReady: false, tosReady: false, todayYuan: 0, uncertainToday: 0 });
  expect([...list.main, ...list.optional].every(row => row.ok)).toBe(true);
});

it("保存时火山说 Key 不对：填了也照还不能用算，说清是现在填的不认、叫重新填", () => {
  const bad = featureChecklist(full, true).main;
  expect(bad[0]).toMatchObject({ name: "出图、出视频", ok: false, state: "还不能用，缺 对的火山 Key（现在填的火山不认）" });
  expect(bad[0].fix).toContain("重新填一次火山 Key");
  expect(bad[1].ok).toBe(false);
  expect(bad[2].ok).toBe(true);
  expect(featureChecklist({ ...full, fake: true }, true).main[0].ok).toBe(true);
});
