// 参考便携版 ComfyUI 0.43.0 / 426f5eea52a7ece1dd599fff4cb6cd1f352ddd24。
// 全部由 Comfy-Org/ComfyUI 自带提供，不能误报成需要另装第三方节点包。
export const CUSTOM_NODE_PACKAGES = [];
export const NODE_SOURCES = {
  'nodes.py': ['CheckpointLoaderSimple', 'CLIPTextEncode', 'UNETLoader'],
  'comfy_extras/nodes_video.py': ['LoadVideo', 'GetVideoComponents', 'CreateVideo', 'SaveVideo'],
  'comfy_extras/nodes_sam3.py': ['SAM3_VideoTrack'],
  'comfy_extras/nodes_rtdetr.py': ['RTDETR_detect'],
  'comfy_extras/nodes_moge.py': ['LoadMoGeModel', 'MoGeInference', 'MoGeGeometryToFOV'],
  'comfy_extras/nodes_sam3d_body.py': ['SAM3DBody_Loader', 'SAM3DBody_Predict', 'SAM3DBody_Smooth', 'SAM3DBody_Render'],
};

// 下载地址和字节数由 Claude 于 11-01 联网核对，与可运行环境的四个文件一致。
export const MODEL_DOWNLOADS = {
  'sam3.1_multiplex_fp16.safetensors': {
    url: 'https://huggingface.co/Comfy-Org/sam3.1/resolve/main/checkpoints/sam3.1_multiplex_fp16.safetensors',
    bytes: 1745546848,
  },
  'sam_3d_body_dinov3_bf16.safetensors': {
    url: 'https://huggingface.co/Comfy-Org/sam-3d-body/resolve/main/detection/sam_3d_body_dinov3_bf16.safetensors',
    bytes: 2830737652,
  },
  'rt_detr_v4-x-hgnet_fp32.safetensors': {
    url: 'https://huggingface.co/Comfy-Org/RT-DETR/resolve/main/diffusion_models/rt_detr_v4-x-hgnet_fp32.safetensors',
    bytes: 247790660,
  },
  'moge_2_vitl_normal_fp16.safetensors': {
    url: 'https://huggingface.co/Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors',
    bytes: 661859924,
  },
};

export const modelSize = bytes => `${(bytes / 1e9).toFixed(1)} GB`;
