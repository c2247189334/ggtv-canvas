// 视频目录、价格和限制与 src/domain/videoModels.ts 保持一致。
export const VIDEO_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
const pixels = {
  '480p': [[864, 496], [752, 560], [640, 640], [560, 752], [496, 864], [992, 432]],
  '720p': [[1280, 720], [1112, 834], [960, 960], [834, 1112], [720, 1280], [1470, 630]],
  '1080p': [[1920, 1080], [1664, 1248], [1440, 1440], [1248, 1664], [1080, 1920], [2206, 946]]
};
const pixels25 = { ...pixels, '480p': [[854, 480], [752, 560], [640, 640], [560, 752], [480, 854], [992, 432]] };
const limits = { minDuration: 4, maxDuration: 15, maxImages: 9, maxVideos: 3, minVideoSeconds: 2, maxVideoSeconds: 15, maxVideoTotal: 15,
  minAudioSeconds: 2, maxAudioSeconds: 15, maxAudios: 3, maxAudioTotal: 15, allowAudioOnly: false };
export const VIDEO_MODELS = [
  { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], prices: { '480p': [23, 14], '720p': [23, 14] }, pixels, ...limits },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], prices: { '480p': [37, 22], '720p': [37, 22] }, pixels, ...limits },
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p'], prices: { '480p': [46, 28], '720p': [46, 28], '1080p': [51, 31] }, pixels, ...limits },
  { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], prices: { '480p': [70, 42], '720p': [70, 42], '1080p': [77, 46] }, pixels: pixels25, ...limits,
    maxDuration: 30, maxImages: 30, maxVideos: 10, maxVideoSeconds: 30, maxVideoTotal: 30, maxAudioSeconds: 30, maxAudios: 10, maxAudioTotal: 30, allowAudioOnly: true }
];
export const DEFAULT_VIDEO_SETTINGS = { model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', ratio: '16:9', resolution: '480p', duration: 5, audio: true };

export function videoModelOf(id) {
  return VIDEO_MODELS.find((model) => model.id === id);
}
export function videoPrice(model, resolution, withVideo = false) {
  const price = videoModelOf(model)?.prices[resolution];
  if (!price) throw new Error('视频模型或清晰度不支持。');
  return price[withVideo ? 1 : 0];
}
export function estimateVideo({ model, resolution, ratio, duration, refVideoSeconds = 0 }) {
  const info = videoModelOf(model);
  if (!info || !info.resolutions.includes(resolution) || !VIDEO_RATIOS.includes(ratio)) throw new Error('视频模型、清晰度或比例不支持。');
  if (!Number.isInteger(duration) || duration < info.minDuration || duration > info.maxDuration || !Number.isFinite(refVideoSeconds) || refVideoSeconds < 0) throw new Error('视频秒数不合规。');
  const sizes = info.pixels[resolution];
  const area = ratio === 'adaptive' ? Math.max(...sizes.map(([w, h]) => w * h)) : sizes[VIDEO_RATIOS.indexOf(ratio)].reduce((a, b) => a * b);
  const tokens = (duration + refVideoSeconds) * area * 24 / 1024;
  const withVideo = refVideoSeconds > 0;
  return { yuan: tokens * videoPrice(model, resolution, withVideo) / 1e6, tokens, withVideo, note: withVideo ? '带参考视频时火山还有最低 token 用量，估出来可能偏低；实收以火山查询结果为准。' : '按官方公式估算，实收以火山查询结果为准。' };
}
export function normalizeVideoSettings(settings) {
  const model = videoModelOf(settings.model) ?? VIDEO_MODELS[0];
  const resolution = model.resolutions.includes(settings.resolution) ? settings.resolution : model.resolutions.includes('720p') ? '720p' : '480p';
  const mode = settings.mode === 'first_frame' ? 'first_frame' : 'reference';
  const ratio = mode === 'first_frame' && model.id === 'doubao-seedance-2-5-260628' ? 'adaptive' : VIDEO_RATIOS.includes(settings.ratio) ? settings.ratio : '16:9';
  const duration = Math.max(model.minDuration, Math.min(model.maxDuration, Math.round(Number.isFinite(settings.duration) ? settings.duration : 5)));
  return { model: model.id, mode, ratio, resolution, duration, audio: typeof settings.audio === 'boolean' ? settings.audio : true };
}
export function checkVideoRefs({ model, mode, images, videos, audios = [] }) {
  const info = videoModelOf(model);
  if (!info) return ['视频模型认不出来。'];
  const problems = [];
  if (mode !== 'reference' && mode !== 'first_frame') problems.push('视频模式认不出来。');
  if (!Number.isInteger(images) || images < 0) problems.push('参考图张数不对。');
  if (mode === 'first_frame' && images !== 1) problems.push('首帧模式要正好 1 张参考图。');
  if (mode === 'first_frame' && videos.length) problems.push('首帧模式不能带视频。');
  if (mode === 'first_frame' && audios.length) problems.push('首帧模式不能带音频。');
  if (images + videos.length > 8) problems.push('图和视频加起来最多 8 个参考。');
  if (images > info.maxImages) problems.push('参考图最多 ' + info.maxImages + ' 张。');
  if (videos.length > info.maxVideos) problems.push('参考视频最多 ' + info.maxVideos + ' 段。');
  if (videos.some((seconds) => !Number.isFinite(seconds) || seconds < info.minVideoSeconds || seconds > info.maxVideoSeconds)) problems.push('每段参考视频要在 ' + info.minVideoSeconds + ' 到 ' + info.maxVideoSeconds + ' 秒之间。');
  if (videos.reduce((sum, seconds) => sum + seconds, 0) > info.maxVideoTotal) problems.push('参考视频加起来不能超 ' + info.maxVideoTotal + ' 秒。');
  if (audios.length && !info.allowAudioOnly && images + videos.length === 0) problems.push('这个模型带音频时至少还要 1 张参考图或 1 段参考视频。');
  if (audios.length > info.maxAudios) problems.push(`@音频${info.maxAudios + 1} 超过限制：参考音频最多 ${info.maxAudios} 段。`);
  audios.forEach((seconds, index) => {
    if (!Number.isFinite(seconds) || seconds < info.minAudioSeconds || seconds > info.maxAudioSeconds) problems.push(`@音频${index + 1} 要在 ${info.minAudioSeconds} 到 ${info.maxAudioSeconds} 秒之间。`);
  });
  let audioTotal = 0;
  const crossing = audios.findIndex(seconds => (audioTotal += seconds) > info.maxAudioTotal);
  if (crossing >= 0) problems.push(`@音频${crossing + 1} 加入后超限：参考音频加起来不能超 ${info.maxAudioTotal} 秒。`);
  return problems;
}

