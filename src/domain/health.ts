import type { Health } from "@/types";

/** 11-17 用户定：缺 ffmpeg 的提示要说怎么办。提示条只留 4 秒，放不下整条命令，所以指去「设置」，装法写在设置的功能清单里。 */
export const FFMPEG_MISSING = "没找到 ffmpeg（处理视频的小工具）：点右上角「设置」看怎么装。";
export const FFMPEG_HOW = "按 Win 键搜「终端」打开，粘贴 winget install Gyan.FFmpeg 回车；装完关掉黑窗口，重新双击「一键启动.bat」。";

/** 配置体检只给状态，页面只列缺少的变量名，不展示本机路径。 */
export function missingDepthConfig(depth?: Health["depth"]): string[] {
  const fields = [
    ["DEPTH_PYTHON", depth?.python],
    ["DEPTH_MODEL_DIR", depth?.modelDir],
    ["DEPTH_EXTRA_PACKAGES", depth?.extraPackages]
  ] as const;
  return fields.filter(([name, status]) => name === "DEPTH_EXTRA_PACKAGES" ? status?.filled && !status.found : !status?.filled || !status.found).map(([name]) => name);
}

/** 就绪由服务端探活或有效便携版决定；未知状态保守拦截。 */
export function missingMeshConfig(mesh?: Health['mesh']): string[] {
  if (!mesh?.url.found) return ['COMFYUI_URL', 'COMFYUI_DIR'];
  return mesh.ready ? [] : ['COMFYUI_DIR'];
}

export function meshConfigProblem(mesh?: Health['mesh']): string | null {
  if (!missingMeshConfig(mesh).length) return null;
  return `白模动作捕捉未就绪，请先打开 ComfyUI，或在 .env.local 填好 COMFYUI_DIR。${mesh?.url.filled && !mesh.url.found ? 'COMFYUI_URL 只支持本机地址，请检查填写。' : ''}`;
}
