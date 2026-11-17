import type { Health } from "@/types";
import { FFMPEG_HOW, missingDepthConfig, meshConfigProblem } from "./health";

/**
 * 11-17 用户定：设置面板不再摆一排变量名，改成「功能清单」——每行一个功能：能不能用、缺什么、怎么办。
 * 深度、白模是选装，单独一组（页面上默认折叠），免得新手以为装坏了。
 */
export type FeatureRow = { name: string; ok: boolean; state: string; fix: string | null };

const row = (name: string, missing: string[], fix: string, okState = "能用"): FeatureRow => missing.length
  ? { name, ok: false, state: `还不能用，缺 ${missing.join("、")}`, fix }
  : { name, ok: true, state: okState, fix: null };

const AGENT = "本机 AI 助手";
const RESTART = "关掉黑窗口，重新双击「一键启动.bat」";

/** keyRejected：这次保存时火山回了 401（填了但不对），出图出视频那两行照「还不能用」算。 */
export function featureChecklist(health: Health, keyRejected = false): { main: FeatureRow[]; optional: FeatureRow[] } {
  const fake = health.fake;
  const badKey = !fake && health.keyReady && keyRejected;
  const noKey = !fake && (!health.keyReady || keyRejected), noTos = !fake && !health.tosReady;
  const keyName = badKey ? "对的火山 Key（现在填的火山不认）" : "火山 Key";
  const noFfmpeg = !fake && !health.ffmpegFound, noAgent = !fake && !health.agentReady;
  const agentFix = `${health.agentProblem || "本机 Claude 或 Codex 没配好。"}装好并用自己的账号登录一次，在下面「本机 AI 助手用谁」点「重新检查」；还认不到再${RESTART}。只出图出视频不需要。`;
  const agentOk = health.agentName ? `能用（${health.agentName}${health.agentModel ? `，模型 ${health.agentModel}` : ""}）` : "能用";
  const depthMissing = fake ? [] : missingDepthConfig(health.depth);
  const meshProblem = fake ? null : meshConfigProblem(health.mesh);
  return {
    main: [
      row("出图、出视频", noKey ? [keyName] : [], badKey ? "在填写框里重新填一次火山 Key 点保存。照「怎么拿 Key」第 2 步核对，别多带空格、别漏字符。" : "在这个面板的填写框里填好点保存，不用重启。还没有 Key 就点开「怎么拿 Key」。"),
      row("拿视频当参考出片", [...(noKey ? [keyName] : []), ...(noTos ? ["TOS 三项"] : [])],
        "在填写框里填好点保存。TOS 是火山的网盘，用来临时放参考视频；只出图、用文字或图片出视频用不到它。"),
      row("片段截取、视频截图、提取原声", noFfmpeg ? ["ffmpeg（处理视频的小工具）"] : [], `装 ffmpeg：${FFMPEG_HOW}`),
      row("帮我改写", noAgent ? [AGENT] : [], agentFix, agentOk),
      row("视频改写、拆解", [...(noAgent ? [AGENT] : []), ...(noFfmpeg ? ["ffmpeg"] : [])],
        `${noAgent ? "本机 AI 助手的接法见上一条。" : ""}${noFfmpeg ? "ffmpeg 的装法见「片段截取」那一条。" : ""}`, agentOk)
    ],
    optional: [
      row("深度动作捕捉", depthMissing.length ? ["深度环境"] : noFfmpeg || (!fake && !health.ffprobeFound) ? ["ffmpeg"] : [],
        depthMissing.length
          ? `要 NVIDIA 显卡。双击项目文件夹里的「安装深度.bat」，它会自己配好（${depthMissing.join("、")}），装完${RESTART}。`
          : "ffmpeg 的装法见「片段截取」那一条。"),
      row("白模动作捕捉", meshProblem ? ["ComfyUI"] : noFfmpeg ? ["ffmpeg"] : [],
        meshProblem
          ? `要 ComfyUI 便携版和 4 个模型，步骤见安装说明的「选装白模」，双击「检查白模环境.bat」能体检。${health.mesh?.url.filled && !health.mesh.url.found ? "现在填的 ComfyUI 地址不是本机地址，请检查。" : ""}`
          : "ffmpeg 的装法见「片段截取」那一条。")
    ]
  };
}
