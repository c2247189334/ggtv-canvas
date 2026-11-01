/** 技术原文由执行入口记日志；卡上只给固定的人话，不能带本机路径或堆栈。 */
export function meshError(error) {
  const raw = String(error?.message ?? error);
  let reason;
  if (error?.gpuUnsafe) reason = `无法确认 ComfyUI ${raw.includes('是否接单') ? '是否接单' : '已停止'}，本机显卡队列已暂停；确认停止后请重启小服务。`;
  else if (/out of memory|OutOfMemory/i.test(raw)) reason = '显存不够，请关掉其他占显存的软件后再重试。';
  else if (/NO_CUDA|no CUDA|CUDA.*available|没.*CUDA/i.test(raw)) reason = '没找到可用的 CUDA 显卡，请检查显卡环境后重试。';
  else if (/COMFYUI_URL/.test(raw)) reason = 'ComfyUI 地址不对，请在 .env.local 检查 COMFYUI_URL，只填写本机地址。';
  else if (/COMFYUI_DIR.*找不到/.test(raw)) reason = '白模便携版文件没找齐，请在 .env.local 检查 COMFYUI_DIR，或先打开 ComfyUI。';
  else if (/启动超时/.test(raw)) reason = 'ComfyUI 启动超时，请先手动打开 ComfyUI 再重试。';
  else if (/启动失败/.test(raw)) reason = 'ComfyUI 启动失败，请检查便携版能否正常打开，详情见小服务日志。';
  else if (/连不上 ComfyUI/.test(raw)) reason = '连不上 ComfyUI，请先打开它，或在 .env.local 填好 COMFYUI_DIR，再重试。';
  else if (/超时/.test(raw)) reason = 'ComfyUI 处理超时，请检查它的运行状态后再重试。';
  else if (/没有白模节点/.test(raw)) reason = 'ComfyUI 没有白模节点，请安装所需节点并检查 COMFYUI_URL 的端口。';
  else if (/缺少模型/.test(raw)) reason = '白模缺少所需模型，请检查 ComfyUI 的模型安装，详情见小服务日志。';
  else if (/ComfyUI 上传/.test(raw)) reason = '上传参考视频失败，请检查 ComfyUI 的可用磁盘空间后再重试。';
  else if (/输出视频的尺寸不对/.test(raw)) reason = '输出视频的尺寸不对，请检查 ComfyUI 工作流后重试。';
  else if (/输出视频的帧率或时长不对/.test(raw)) reason = '输出视频的帧率或时长不对，请检查 ComfyUI 工作流后重试。';
  else if (/没有找到白模视频输出|输出不是有效的视频/.test(raw)) reason = '没得到有效的白模视频，请检查 ComfyUI 输出节点后重试。';
  else if (/白模单的编号/.test(raw)) reason = '白模单的编号不对，请重新发起白模动作捕捉。';
  else if (/视频来源的编号/.test(raw)) reason = '视频来源的编号不对，请重新选择原视频。';
  else if (/作品已删除|上传的视频找不到/.test(raw)) reason = '来源视频找不到了，请重新上传或选择原视频。';
  else if (/原片超过 30 秒/.test(raw)) reason = '原片超过 30 秒，请先截短后再做白模动作捕捉。';
  else if (/请选择一个视频来源/.test(raw)) reason = '来源不是视频，请重新选择原视频。';
  else if (/释放显存失败/.test(raw)) reason = 'ComfyUI 未能释放显存，请检查它的运行状态，详情见小服务日志。';
  else if (/清理失败/.test(raw)) reason = '白模临时文件清理失败，请检查可用磁盘空间，详情见小服务日志。';
  else if (/ENOENT|ffmpeg/i.test(raw)) reason = '本机视频处理失败，请检查 ffmpeg 和来源视频，详情见小服务日志。';
  else reason = '白模处理失败，请检查 ComfyUI 的节点、模型和运行状态，详情见小服务日志。';
  return `本地处理失败，没有自动重跑，花费 0。\n${reason}`;
}
