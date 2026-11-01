import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkVideoJobInput } from './videoJobInput.mjs';
import { DEFAULT_VIDEO_SETTINGS } from './videoModels.mjs';
const REF = { type: 'upload', id: '22222222-2222-4222-8222-222222222222' };
const good = { ...DEFAULT_VIDEO_SETTINGS, canvasId: '11111111-1111-4111-8111-111111111111', cardId: 'card-ab12', prompt: ' 一只猫 ', refs: [] };
const image = { kind: 'image', contentType: 'image/png', buffer: Buffer.from('png') };
const video = { kind: 'video', contentType: 'video/mp4', duration: 3, width: 1280, height: 720, bytes: 4096 };
test('合格视频单：kind、估价、参考种类和元数据落盘', () => {
  const checked = checkVideoJobInput({ ...good, refs: [REF] }, () => video);
  assert.equal(checked.ok, true);
  assert.equal(checked.job.kind, 'video');
  assert.equal(checked.job.prompt, '一只猫');
  assert.equal(checked.job.priceYuan, 1.124928);
  assert.deepEqual(checked.job.refs, [{ ...REF, kind: 'video', duration: 3, width: 1280, height: 720 }]);
});
test('真人素材编号仅保留安全字符，参考种类以服务端为准', () => {
  const checked = checkVideoJobInput({ ...good, refs: [{ ...REF, asset: 'person_1.foo-bar', kind: 'video' }] }, () => image);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.job.refs, [{ ...REF, asset: 'person_1.foo-bar', kind: 'image' }]);
});
const bad = [
  [{ canvasId: '../x' }, /画布/], [{ cardId: 'a/b' }, /卡片/],
  [{ model: 'x' }, /模型/], [{ mode: 'x' }, /模式/],
  [{ prompt: ' ' }, /先写/], [{ prompt: '字'.repeat(4001) }, /太长/],
  [{ ratio: '7:2' }, /比例/], [{ resolution: '1080p' }, /清晰度/],
  [{ duration: 3 }, /时长/], [{ duration: 5.1 }, /时长/], [{ duration: -1 }, /时长/],
  [{ audio: 'true' }, /声音/], [{ refs: 'x' }, /参考/],
  [{ refs: [{ type: 'url', id: REF.id }] }, /编号/],
  [{ refs: [{ ...REF, asset: 'a/b' }] }, /素材编号/],
  [{ refs: [{ ...REF, asset: 'a'.repeat(129) }] }, /素材编号/],
  [{ mode: 'first_frame' }, /正好 1 张/],
  [{ model: 'doubao-seedance-2-5-260628', mode: 'first_frame', refs: [REF] }, /adaptive/]
];
for (const [patch, pattern] of bad) test('拒收不合格字段 ' + JSON.stringify(patch).slice(0, 80), () => {
  const checked = checkVideoJobInput({ ...good, ...patch }, () => image);
  assert.equal(checked.ok, false);
  assert.match(checked.reason, pattern);
});
test('拒收视频违规元数据、素材编号和首帧带视频', () => {
  for (const patch of [{ duration: 0 }, { duration: NaN }, { width: 299 }, { height: 6001 }, { width: 300, height: 300 }, { width: 6000, height: 6000 }, { width: 300, height: 2000 }]) {
    const checked = checkVideoJobInput({ ...good, refs: [REF] }, () => ({ ...video, ...patch }));
    assert.equal(checked.ok, false, JSON.stringify(patch));
  }
  assert.match(checkVideoJobInput({ ...good, refs: [{ ...REF, asset: 'person' }] }, () => video).reason, /只能.*图/);
  assert.match(checkVideoJobInput({ ...good, mode: 'first_frame', refs: [REF] }, () => video).reason, /首帧/);
});
test('不接受不存在、不认识的参考和超限总秒数', () => {
  assert.match(checkVideoJobInput({ ...good, refs: [REF] }, () => null).reason, /找不到/);
  assert.match(checkVideoJobInput({ ...good, refs: [REF] }, () => ({ kind: 'audio' })).reason, /类型/);
  assert.match(checkVideoJobInput({ ...good, refs: [REF, REF, REF] }, () => ({ ...video, duration: 6 })).reason, /加起来.*15 秒/);
});

const AUDIO_REF = { type: 'work', id: '33333333-3333-4333-8333-333333333333' };
const audio = { kind: 'audio', contentType: 'audio/wav', duration: 4, bytes: 4096, sampleRate: 24000, channels: 1, bitsPerSample: 16 };

test('改写任务类型只收2.5的reference，普通单不添字段', () => {
  const job = checkVideoJobInput({ ...good, model: 'doubao-seedance-2-5-260628', taskType: 'reference' }, () => image);
  assert.equal(job.ok, true);
  assert.equal(job.job.taskType, 'reference');
  assert.equal(Object.hasOwn(checkVideoJobInput(good, () => image).job, 'taskType'), false);
  for (const taskType of ['edit', 'auto', null, 1]) {
    assert.match(checkVideoJobInput({ ...good, taskType }, () => image).reason, /任务类型/);
  }
  assert.match(checkVideoJobInput({ ...good, taskType: 'reference' }, () => image).reason, /2.5/);
});
test('配回原声：来源要是有声音的视频、生成音频要关；合格时只落类型和编号，普通单不添字段', () => {
  const sound = { ...video, hasAudio: true };
  const checked = checkVideoJobInput({ ...good, audio: false, soundtrack: { ...REF, extra: 'x' } }, () => sound);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.job.soundtrack, REF);
  assert.equal(Object.hasOwn(checkVideoJobInput(good, () => image).job, 'soundtrack'), false);
  assert.match(checkVideoJobInput({ ...good, audio: true, soundtrack: REF }, () => sound).reason, /生成音频/);
  assert.match(checkVideoJobInput({ ...good, audio: false, soundtrack: REF }, () => ({ ...video, hasAudio: false })).reason, /没有声音/);
  assert.match(checkVideoJobInput({ ...good, audio: false, soundtrack: REF }, () => null).reason, /找不到/);
  assert.match(checkVideoJobInput({ ...good, audio: false, soundtrack: REF }, () => image).reason, /视频/);
  for (const soundtrack of [null, 'x', { type: 'disk', id: REF.id }, { type: 'work', id: '../x' }]) {
    assert.match(checkVideoJobInput({ ...good, audio: false, soundtrack }, () => sound).reason, /配回原声/);
  }
});
const V25 = 'doubao-seedance-2-5-260628';
test('声音只来自作品，种类时长和大小读取服务端，不信页面字段且保留提示词引用', () => {
  const checked = checkVideoJobInput({ ...good, model: V25, prompt: '照着@音频1的节奏', refs: [{ ...AUDIO_REF, duration: 100, kind: 'image', bytes: 0 }] }, () => audio);
  assert.equal(checked.ok, true);
  assert.equal(checked.job.prompt, '照着@音频1的节奏');
  assert.deepEqual(checked.job.refs, [{ ...AUDIO_REF, kind: 'audio', duration: 4, contentType: 'audio/wav', bytes: 4096 }]);
  assert.match(checkVideoJobInput({ ...good, model: V25, refs: [REF] }, () => audio).reason, /@音频1.*作品/);
});
test('声音格式大小和时长按音频独立编号拒收，首帧不能带声音', () => {
  const refs = [REF, AUDIO_REF, AUDIO_REF];
  for (const [patch, pattern] of [
    [{ contentType: 'audio/ogg' }, /@音频2.*wav.*mp3/i], [{ bytes: 15 * 1024 * 1024 + 1 }, /@音频2.*15.*MB/],
    [{ bytes: 0 }, /@音频2.*大小/], [{ bytes: NaN }, /@音频2.*大小/],
    [{ duration: 0 }, /@音频2.*2.*15/], [{ duration: NaN }, /@音频2.*2.*15/], [{ duration: 16 }, /@音频2.*2.*15/]
  ]) {
    let count = 0;
    const result = checkVideoJobInput({ ...good, refs }, ref => ref.type === 'upload' ? image : ++count === 1 ? audio : { ...audio, ...patch });
    assert.equal(result.ok, false);
    assert.match(result.reason, pattern);
  }
  for (const contentType of ['audio/wav', 'audio/mpeg']) {
    assert.equal(checkVideoJobInput({ ...good, refs: [REF, AUDIO_REF] }, ref => ref.type === 'upload' ? image : { ...audio, contentType, bytes: 15 * 1024 * 1024 }).ok, true);
  }
  assert.match(checkVideoJobInput({ ...good, mode: 'first_frame', refs: [REF, AUDIO_REF] }, ref => ref.type === 'upload' ? image : audio).reason, /首帧.*音频/);
});
test('声音不占8个图视频名额，2.0不能纯声音，2.5可用10段共30秒', () => {
  const read = ref => ref.type === 'upload' ? image : { ...audio, duration: 3 };
  assert.equal(checkVideoJobInput({ ...good, refs: [...Array(8).fill(REF), AUDIO_REF] }, read).ok, true);
  assert.match(checkVideoJobInput({ ...good, refs: [AUDIO_REF] }, read).reason, /至少.*图.*视频/);
  assert.equal(checkVideoJobInput({ ...good, model: V25, refs: Array(10).fill(AUDIO_REF) }, read).ok, true);
  assert.match(checkVideoJobInput({ ...good, refs: [...Array(9).fill(REF), AUDIO_REF] }, read).reason, /最多 8/);
});
test('已知视频fps必须24到60，兼容未记录fps的旧作品', () => {
  for (const fps of [24, 60, null, undefined]) assert.equal(checkVideoJobInput({ ...good, refs: [REF] }, () => ({ ...video, fps })).ok, true);
  for (const fps of [23.99, 60.01, 0, NaN, Infinity]) assert.match(checkVideoJobInput({ ...good, refs: [REF] }, () => ({ ...video, fps })).reason, /24.*60/);
});

test('上传/作品参考视频超过200MB在交单前拒收，按视频独立编号说清大小和处理办法', () => {
  for (const type of ['upload', 'work']) {
    let count = 0;
    const result = checkVideoJobInput({ ...good, refs: [REF, { ...REF, type }, { ...REF, type }] }, () =>
      ++count === 1 ? image : { ...video, bytes: count === 2 ? 209715200 : 350 * 1024 * 1024 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, '@视频2 有 350MB，火山规定单个参考视频不超过 200MB，请先压缩或截短再发。');
    assert.equal(checkVideoJobInput({ ...good, refs: [{ ...REF, type }] }, () => ({ ...video, bytes: 209715200 })).ok, true);
    for (const bytes of [undefined, 0, NaN, -1, 1.5]) {
      const missing = checkVideoJobInput({ ...good, refs: [{ ...REF, type }] }, () => ({ ...video, bytes }));
      assert.equal(missing.ok, false);
      assert.match(missing.reason, /@视频1.*读不出文件大小.*重新上传/);
    }
  }
});

test('交单前按模型拦参考视频：2.0为2~15秒最多3段总15秒，2.5为2~30秒', () => {
  for (const [model, max] of [[good.model, 15], [V25, 30]]) {
    for (const duration of [1.99, max + 0.01]) {
      const checked = checkVideoJobInput({ ...good, model, refs: [REF] }, () => ({ ...video, duration }));
      assert.equal(checked.ok, false);
      assert.match(checked.reason, new RegExp(`每段参考视频.*2.*${max}`));
    }
    for (const duration of [2, max]) assert.equal(checkVideoJobInput({ ...good, model, refs: [REF] }, () => ({ ...video, duration })).ok, true);
  }
  assert.match(checkVideoJobInput({ ...good, refs: Array(4).fill(REF) }, () => video).reason, /最多 3/);
});
