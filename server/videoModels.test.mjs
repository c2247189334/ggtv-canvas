import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIDEO_MODELS, DEFAULT_VIDEO_SETTINGS, estimateVideo, normalizeVideoSettings, checkVideoRefs, videoPrice } from './videoModels.mjs';

const MINI = 'doubao-seedance-2-0-mini-260615';
const V2 = 'doubao-seedance-2-0-260128';
const V25 = 'doubao-seedance-2-5-260628';
const FAST = 'doubao-seedance-2-0-fast-260128';
const cases = [
  [MINI, '480p', '16:9', 5, 0, 50220, 1.155060],
  [MINI, '480p', '16:9', 5, 3, 80352, 1.124928],
  [V25, '720p', '16:9', 5, 0, 108000, 7.560000],
  [V2, '1080p', '9:16', 10, 0, 486000, 24.786000],
  [V25, '480p', 'adaptive', 4, 0, 40176, 2.812320],
  [FAST, '720p', '1:1', 15, 15, 648000, 14.256000]
];
for (const [model, resolution, ratio, duration, refVideoSeconds, tokens, yuan] of cases) {
  test(`官方估价 ${model} ${resolution} ${ratio} ${refVideoSeconds}`, () => {
    const got = estimateVideo({ model, resolution, ratio, duration, refVideoSeconds });
    assert.equal(got.tokens, tokens);
    assert.ok(Math.abs(got.yuan - yuan) <= 0.0001);
    assert.equal(got.withVideo, refVideoSeconds > 0);
    if (got.withVideo) assert.match(got.note, /最低 token 用量.*可能偏低/);
  });
}
test('四个模型、默认设置及全部单价', () => {
  assert.equal(VIDEO_MODELS.length, 4);
  assert.deepEqual(DEFAULT_VIDEO_SETTINGS, { model: MINI, mode: 'reference', ratio: '16:9', resolution: '480p', duration: 5, audio: true });
  assert.deepEqual(VIDEO_MODELS.map((m) => videoPrice(m.id, '720p', false)), [23, 37, 46, 70]);
  assert.deepEqual(VIDEO_MODELS.map((m) => videoPrice(m.id, '480p', true)), [14, 22, 28, 42]);
  assert.equal(videoPrice(V2, '1080p', false), 51);
  assert.equal(videoPrice(V2, '1080p', true), 31);
  assert.equal(videoPrice(V25, '1080p', false), 77);
  assert.equal(videoPrice(V25, '1080p', true), 46);
});
test('切模型纠正清晰度、时长、2.5首帧比例', () => {
  assert.equal(normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, resolution: '1080p' }).resolution, '720p');
  const fixed = normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, model: V25, mode: 'first_frame', duration: 99 });
  assert.equal(fixed.ratio, 'adaptive');
  assert.equal(fixed.duration, 30);
  assert.equal(normalizeVideoSettings({ ...DEFAULT_VIDEO_SETTINGS, duration: 1 }).duration, 4);
});
test('参考限制：首帧、总数、段数、单段、总秒数', () => {
  const check = (patch) => checkVideoRefs({ model: MINI, mode: 'reference', images: 0, videos: [], ...patch });
  assert.deepEqual(check({}), []);
  assert.match(check({ videos: [6, 6, 5] }).join(''), /加起来.*15 秒/);
  assert.match(check({ mode: 'first_frame', images: 1, videos: [2] }).join(''), /不能带视频/);
  assert.match(check({ mode: 'first_frame' }).join(''), /正好 1 张/);
  assert.match(check({ images: 8, videos: [2] }).join(''), /8/);
  assert.match(check({ videos: [2, 2, 2, 2] }).join(''), /3 段/);
  assert.match(check({ videos: [1] }).join(''), /2.*15 秒/);
  assert.deepEqual(check({ model: V25, videos: [30] }), []);
});
test('估价不接受不支持的设置和无效秒数', () => {
  assert.throws(() => estimateVideo({ ...DEFAULT_VIDEO_SETTINGS, model: 'unknown' }));
  assert.throws(() => estimateVideo({ ...DEFAULT_VIDEO_SETTINGS, resolution: '1080p' }));
  assert.throws(() => estimateVideo({ ...DEFAULT_VIDEO_SETTINGS, refVideoSeconds: NaN }));
});

test('声音目录与规则：2.0要图或视频，2.5可纯声音，音频独立计数', () => {
  assert.deepEqual(VIDEO_MODELS.map(m => [m.minAudioSeconds, m.maxAudioSeconds, m.maxAudios, m.maxAudioTotal, m.allowAudioOnly]),
    [[2, 15, 3, 15, false], [2, 15, 3, 15, false], [2, 15, 3, 15, false], [2, 30, 10, 30, true]]);
  const check = patch => checkVideoRefs({ model: MINI, mode: 'reference', images: 1, videos: [], audios: [], ...patch });
  assert.deepEqual(check({ images: 8, audios: [2, 2, 2] }), []);
  assert.match(check({ images: 0, audios: [2] }).join(''), /至少.*图.*视频/);
  assert.deepEqual(check({ model: V25, images: 0, audios: [30] }), []);
  assert.match(check({ mode: 'first_frame', audios: [2] }).join(''), /首帧.*音频/);
  assert.match(check({ audios: [2, 2, 2, 2] }).join(''), /3 段/);
  assert.match(check({ audios: [8, 8] }).join(''), /加起来.*15 秒/);
  assert.match(check({ audios: [6, 6, 6] }).join(''), /@音频3/);
  for (const value of [1.9, 15.1, NaN, Infinity]) assert.match(check({ audios: [2, value] }).join(''), /@音频2.*2.*15 秒/);
  assert.deepEqual(check({ audios: [2, 13] }), []);
  assert.match(check({ model: V25, audios: Array(11).fill(2) }).join(''), /10 段/);
  assert.match(check({ model: V25, audios: [15, 16] }).join(''), /加起来.*30 秒/);
});
