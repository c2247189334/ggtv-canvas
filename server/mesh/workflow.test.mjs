import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meshWorkflow } from './workflow.mjs';

test('白模工作流逐字段采用实测的网格加深度着色，只替换上传文件名和单号前缀', () => {
  assert.deepEqual(meshWorkflow('mesh-input.mp4', 'video/mesh-order'), {
    1: { class_type: 'LoadVideo', inputs: { file: 'mesh-input.mp4' } },
    2: { class_type: 'GetVideoComponents', inputs: { video: ['1', 0] } },
    3: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sam3.1_multiplex_fp16.safetensors' } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'person', clip: ['3', 1] } },
    5: { class_type: 'SAM3_VideoTrack', inputs: { images: ['2', 0], model: ['3', 0], detection_threshold: 0.5,
      max_objects: 4, detect_interval: 1, conditioning: ['4', 0] } },
    6: { class_type: 'UNETLoader', inputs: { unet_name: 'rt_detr_v4-x-hgnet_fp32.safetensors', weight_dtype: 'default' } },
    7: { class_type: 'RTDETR_detect', inputs: { model: ['6', 0], image: ['2', 0], threshold: 0.5, class_name: 'person', max_detections: 100 } },
    8: { class_type: 'LoadMoGeModel', inputs: { model_name: 'moge_2_vitl_normal_fp16.safetensors' } },
    9: { class_type: 'MoGeInference', inputs: { moge_model: ['8', 0], image: ['2', 0], resolution_level: 9,
      fov_x_degrees: 0, batch_size: 4, force_projection: true, apply_mask: true, refine_steps: 3 } },
    10: { class_type: 'MoGeGeometryToFOV', inputs: { moge_geometry: ['9', 0], axis: 'vertical', unit: 'degrees' } },
    11: { class_type: 'SAM3DBody_Loader', inputs: { model_file: 'sam_3d_body_dinov3_bf16.safetensors' } },
    12: { class_type: 'SAM3DBody_Predict', inputs: { sam3d_body_model: ['11', 0], image: ['2', 0],
      run_hand_refinement: true, fov: ['10', 0], batch_size: 64, track_data: ['5', 0], bboxes: ['7', 0] } },
    13: { class_type: 'SAM3DBody_Smooth', inputs: { mhr_pose_data: ['12', 0], strength: 1, method: 'gaussian', window: 7, rotation_threshold_degrees: 15 } },
    21: { class_type: 'SAM3DBody_Render', inputs: { pose_data: ['13', 0], width: 0, height: 0, render_style: 'mesh',
      'render_style.shader': 'depth', 'render_style.opacity': 1, 'render_style.person_palette_falloff': 0.6, 'render_style.region': 'full_body' } },
    '21v': { class_type: 'CreateVideo', inputs: { images: ['21', 0], fps: ['2', 2], bit_depth: 8, color_space: 'sRGB' } },
    '21s': { class_type: 'SaveVideo', inputs: { video: ['21v', 0], filename_prefix: 'video/mesh-order', format: 'auto', 'format.codec': 'auto' } },
  });
});
