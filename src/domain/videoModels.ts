export type VideoModelId = 'doubao-seedance-2-0-mini-260615' | 'doubao-seedance-2-0-fast-260128' | 'doubao-seedance-2-0-260128' | 'doubao-seedance-2-5-260628';
export type VideoMode = 'reference' | 'first_frame';
export type VideoResolution = '480p' | '720p' | '1080p';
export type VideoRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16' | '21:9' | 'adaptive';
export type VideoSettings = { model: VideoModelId; mode: VideoMode; ratio: VideoRatio; resolution: VideoResolution; duration: number; audio: boolean };
export type VideoModel = { id: VideoModelId; name: string; resolutions: string[]; pixels: Record<string, number[][]>; minDuration: number; maxDuration: number; maxImages: number; maxVideos: number; minVideoSeconds: number; maxVideoSeconds: number; maxVideoTotal: number; minAudioSeconds: number; maxAudioSeconds: number; maxAudios: number; maxAudioTotal: number; allowAudioOnly: boolean; maxRefs: number };
export type VideoRefInput = { model: string; mode: string; images: number; videos: number[]; audios?: number[] };

// 视频目录和限制与 server/videoModels.mjs 保持一致。
export const VIDEO_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'];
const pixels: Record<string, number[][]> = {
  '480p': [[864, 496], [752, 560], [640, 640], [560, 752], [496, 864], [992, 432]],
  '720p': [[1280, 720], [1112, 834], [960, 960], [834, 1112], [720, 1280], [1470, 630]],
  '1080p': [[1920, 1080], [1664, 1248], [1440, 1440], [1248, 1664], [1080, 1920], [2206, 946]]
};
const pixels25 = { ...pixels, '480p': [[854, 480], [752, 560], [640, 640], [560, 752], [480, 854], [992, 432]] };
const limits = { minDuration: 4, maxDuration: 15, maxImages: 9, maxVideos: 3, minVideoSeconds: 2, maxVideoSeconds: 15, maxVideoTotal: 15,
  minAudioSeconds: 2, maxAudioSeconds: 15, maxAudios: 3, maxAudioTotal: 15, allowAudioOnly: false, maxRefs: 8 };
export const VIDEO_MODELS: VideoModel[] = [
  { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', resolutions: ['480p', '720p'], pixels, ...limits },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', resolutions: ['480p', '720p'], pixels, ...limits },
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', resolutions: ['480p', '720p', '1080p'], pixels, ...limits },
  { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5', resolutions: ['480p', '720p', '1080p'], pixels: pixels25, ...limits,
    maxDuration: 30, maxImages: 30, maxVideos: 10, maxVideoSeconds: 30, maxVideoTotal: 30, maxAudioSeconds: 30, maxAudios: 10, maxAudioTotal: 30, allowAudioOnly: true, maxRefs: 40 }
];
export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { model: 'doubao-seedance-2-0-mini-260615', mode: 'reference', ratio: '16:9', resolution: '480p', duration: 5, audio: true };

export function videoModelOf(id: string) {
  return VIDEO_MODELS.find((model) => model.id === id);
}
export function normalizeVideoSettings(settings: { model?: string; mode?: string; ratio?: string; resolution?: string; duration?: number; audio?: boolean }): VideoSettings {
  const model = videoModelOf(settings.model ?? '') ?? VIDEO_MODELS[0];
  const resolution = model.resolutions.includes(settings.resolution ?? '') ? settings.resolution! : model.resolutions.includes('720p') ? '720p' : '480p';
  const mode = settings.mode === 'first_frame' ? 'first_frame' : 'reference';
  const ratio = mode === 'first_frame' && model.id === 'doubao-seedance-2-5-260628' ? 'adaptive' : VIDEO_RATIOS.includes(settings.ratio ?? '') ? settings.ratio! : '16:9';
  const duration = Math.max(model.minDuration, Math.min(model.maxDuration, Math.round(Number.isFinite(settings.duration) ? settings.duration! : 5)));
  return { model: model.id, mode, ratio: ratio as VideoRatio, resolution: resolution as VideoResolution, duration, audio: typeof settings.audio === 'boolean' ? settings.audio : true };
}
export function checkVideoRefs({ model, mode, images, videos, audios = [] }: VideoRefInput): string[] {
  const info = videoModelOf(model);
  if (!info) return ['视频模型认不出来。'];
  const problems = [];
  if (mode !== 'reference' && mode !== 'first_frame') problems.push('视频模式认不出来。');
  if (!Number.isInteger(images) || images < 0) problems.push('参考图张数不对。');
  if (mode === 'first_frame' && images !== 1) problems.push('首帧模式要正好 1 张参考图。');
  if (mode === 'first_frame' && videos.length) problems.push('首帧模式不能带视频。');
  if (mode === 'first_frame' && audios.length) problems.push('首帧模式不能带音频。');
  if (images + videos.length > info.maxRefs) problems.push('图和视频加起来最多 ' + info.maxRefs + ' 个参考。');
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

