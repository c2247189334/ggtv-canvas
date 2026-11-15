import { expect, test } from 'vitest';
import { DEFAULT_VIDEO_SETTINGS, VIDEO_MODELS, normalizeVideoSettings, checkVideoRefs } from './videoModels';

const MINI = 'doubao-seedance-2-0-mini-260615';
const V25 = 'doubao-seedance-2-5-260628';
test('默认值、四个模型', () => {
  expect(DEFAULT_VIDEO_SETTINGS).toEqual({ model: MINI, mode: 'reference', ratio: '16:9', resolution: '480p', duration: 5, audio: true });
  expect(VIDEO_MODELS).toHaveLength(4);
});
test('设置纠正和参考检查', () => {
  expect(normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, resolution: '1080p' }).resolution).toBe('720p');
  expect(normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, model: V25, mode: 'first_frame', duration: 99 })).toMatchObject({ ratio: 'adaptive', duration: 30 });
  const check = (videos: number[]) => checkVideoRefs({ model: MINI, mode: 'reference', images: 0, videos });
  expect(check([6, 6, 5]).join('')).toMatch(/加起来.*15 秒/);
  expect(checkVideoRefs({ model: MINI, mode: 'first_frame', images: 1, videos: [2] }).join('')).toMatch(/不能带视频/);
  expect(check([])).toEqual([]);
});

test('声音目录和参考规则与小服务同步', () => {
  expect(VIDEO_MODELS.map(m => [m.minAudioSeconds, m.maxAudioSeconds, m.maxAudios, m.maxAudioTotal, m.allowAudioOnly]))
    .toEqual([[2, 15, 3, 15, false], [2, 15, 3, 15, false], [2, 15, 3, 15, false], [2, 30, 10, 30, true]]);
  const check = (patch: Partial<Parameters<typeof checkVideoRefs>[0]>) => checkVideoRefs({ model: MINI, mode: 'reference', images: 1, videos: [], audios: [], ...patch });
  expect(check({ images: 8, audios: [2, 2, 2] })).toEqual([]);
  expect(check({ images: 0, audios: [2] }).join('')).toMatch(/至少.*图.*视频/);
  expect(check({ model: V25, images: 0, audios: [30] })).toEqual([]);
  expect(check({ mode: 'first_frame', audios: [2] }).join('')).toMatch(/首帧.*音频/);
  expect(check({ audios: [2, 2, 2, 2] }).join('')).toMatch(/3 段/);
  expect(check({ audios: [8, 8] }).join('')).toMatch(/加起来.*15 秒/);
  expect(check({ audios: [6, 6, 6] }).join('')).toMatch(/@音频3/);
  for (const value of [1.9, 15.1, NaN, Infinity]) expect(check({ audios: [2, value] }).join('')).toMatch(/@音频2.*2.*15 秒/);
  expect(check({ audios: [2, 13] })).toEqual([]);
  expect(check({ model: V25, audios: Array(11).fill(2) }).join('')).toMatch(/10 段/);
  expect(check({ model: V25, audios: [15, 16] }).join('')).toMatch(/加起来.*30 秒/);
});
