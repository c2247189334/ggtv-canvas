import type { Health } from "@/types";

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
