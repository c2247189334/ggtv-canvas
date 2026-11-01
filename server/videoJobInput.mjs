// 花钱前检查视频单：只拒收，不替用户悄悄改设置。素材种类和元数据来自服务端存储。
import { isId } from './store/files.mjs';
import { MAX_PROMPT, MAX_REFS } from './jobInput.mjs';
import { VIDEO_RATIOS, videoModelOf, estimateVideo, checkVideoRefs } from './videoModels.mjs';

const no = (reason) => ({ ok: false, reason });
const assetId = /^[A-Za-z0-9._-]{1,128}$/;

function videoProblem(asset, number) {
  const { duration, width, height, fps, bytes } = asset;
  const label = `@视频${number}`;
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return `${label} 读不出文件大小，请重新上传或重新选择作品再发。`;
  if (bytes > 209715200) return `${label} 有 ${Number((bytes / 1024 / 1024).toFixed(2))}MB，火山规定单个参考视频不超过 200MB，请先压缩或截短再发。`;
  if (!Number.isFinite(duration) || duration <= 0) return '参考视频读不出时长或没有视频轨。';
  if (fps != null && (!Number.isFinite(fps) || fps < 24 || fps > 60)) return '参考视频帧率要在 24 到 60 fps 之间。';
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 300 || width > 6000 || height < 300 || height > 6000) return '参考视频每边要在 300 到 6000 像素之间。';
  if (width / height < 0.4 || width / height > 2.5) return '参考视频宽高比要在 0.4 到 2.5 之间。';
  if (width * height < 407696 || width * height > 8295044) return '参考视频总像素要在 407696 到 8295044 之间。';
  return null;
}

function audioProblem(file, ref, number) {
  const label = `@音频${number}`;
  if (ref.type !== 'work') return `参考类型不支持上传音频，${label} 只能来自作品。`;
  if (!['audio/wav', 'audio/mpeg'].includes(file.contentType)) return `${label} 只支持 wav 或 mp3 格式。`;
  if (!Number.isInteger(file.bytes) || file.bytes <= 0) return `${label} 读不出文件大小。`;
  if (file.bytes > 15 * 1024 * 1024) return `${label} 单段文件不能超过 15MB。`;
  return null;
}

/** readAsset(ref) 返回文件真实元数据，找不到返回 null。 */
export function checkVideoJobInput(body, readAsset) {
  const b = body ?? {};
  if (!isId(b.canvasId)) return no('没说是哪张画布。');
  if (typeof b.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.cardId)) return no('没说是哪张卡片。');
  const model = videoModelOf(b.model);
  if (!model) return no('视频模型认不出来。');
  if (b.taskType !== undefined && b.taskType !== 'reference') return no('任务类型只接受 reference。');
  if (b.taskType !== undefined && b.model !== 'doubao-seedance-2-5-260628') return no('任务类型只对 Seedance 2.5 有效，2.0 不能带这个参数。');
  if (b.mode !== 'reference' && b.mode !== 'first_frame') return no('视频模式认不出来。');
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return no('先写一句你想要什么。');
  if (prompt.length > MAX_PROMPT) return no(`提示词太长了（${prompt.length} 字），最多 ${MAX_PROMPT} 字。`);
  if (!VIDEO_RATIOS.includes(b.ratio)) return no('视频比例不支持。');
  if (!model.resolutions.includes(b.resolution)) return no('视频清晰度不支持。');
  if (b.model === 'doubao-seedance-2-5-260628' && b.mode === 'first_frame' && b.ratio !== 'adaptive') return no('Seedance 2.5 首帧模式的比例只能选 adaptive（自适应）。');
  if (!Number.isInteger(b.duration) || b.duration < model.minDuration || b.duration > model.maxDuration) return no(`视频时长要在 ${model.minDuration} 到 ${model.maxDuration} 整数秒之间。`);
  if (typeof b.audio !== 'boolean') return no('声音开关必须是布尔值。');
  let soundtrack;
  if (b.soundtrack !== undefined) {
    const ref = b.soundtrack;
    if (!ref || (ref.type !== 'upload' && ref.type !== 'work') || !isId(ref.id)) return no('配回原声的来源编号不对。');
    if (b.audio !== false) return no('配回原声时要关掉「生成音频」，不然两段声音会叠在一起。');
    const file = readAsset(ref);
    if (!file) return no('配回原声用的原视频在硬盘上找不到了。');
    if (file.kind !== 'video') return no('配回原声的来源必须是视频。');
    if (file.hasAudio !== true) return no('原视频没有声音，没法配回原声。');
    soundtrack = { type: ref.type, id: ref.id };
  }
  if (b.refs !== undefined && !Array.isArray(b.refs)) return no('参考的格式不对。');
  if ((b.refs ?? []).length > MAX_REFS + model.maxAudios) return no(`图和视频加起来最多 ${MAX_REFS} 个参考，音频最多 ${model.maxAudios} 段。`);
  const refs = [];
  let audioCount = 0, videoCount = 0;
  for (const ref of b.refs ?? []) {
    if (!ref || (ref.type !== 'upload' && ref.type !== 'work') || !isId(ref.id)) return no('参考的编号不对。');
    if (ref.asset !== undefined && (typeof ref.asset !== 'string' || !assetId.test(ref.asset))) return no('真人素材编号格式不对，只能用 1 到 128 个英文字母、数字、点、下划线或横线。');
    const file = readAsset(ref);
    if (!file) return no('有一个参考在硬盘上找不到了（可能被删了），断开它再发。');
    if (!['image', 'video', 'audio'].includes(file.kind)) return no('参考文件类型认不出来。');
    if (ref.asset !== undefined && file.kind !== 'image') return no('真人素材编号只能挂在图上。');
    const clean = { type: ref.type, id: ref.id, kind: file.kind };
    if (ref.asset !== undefined) clean.asset = ref.asset;
    if (file.kind === 'video') {
      const problem = videoProblem(file, ++videoCount);
      if (problem) return no(problem);
      Object.assign(clean, { duration: file.duration, width: file.width, height: file.height });
      if (file.fps != null) clean.fps = file.fps;
    }
    if (file.kind === 'audio') {
      const problem = audioProblem(file, ref, ++audioCount);
      if (problem) return no(problem);
      Object.assign(clean, { duration: file.duration, contentType: file.contentType, bytes: file.bytes });
    }
    refs.push(clean);
  }
  const videos = refs.filter((ref) => ref.kind === 'video').map((ref) => ref.duration);
  const audios = refs.filter((ref) => ref.kind === 'audio').map((ref) => ref.duration);
  const issues = checkVideoRefs({ model: b.model, mode: b.mode, images: refs.length - videos.length - audios.length, videos, audios });
  if (issues.length) return no(issues.join(' '));
  const estimate = estimateVideo({ model: b.model, resolution: b.resolution, ratio: b.ratio, duration: b.duration, refVideoSeconds: videos.reduce((sum, duration) => sum + duration, 0) });
  return { ok: true, job: { canvasId: b.canvasId, cardId: b.cardId, kind: 'video', model: b.model, mode: b.mode, prompt, ratio: b.ratio, resolution: b.resolution, duration: b.duration, audio: b.audio, refs, priceYuan: estimate.yuan,
    ...(b.taskType === undefined ? {} : { taskType: b.taskType }), ...(soundtrack ? { soundtrack } : {}) } };
}
