import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createExecutor } from './depth/executor.mjs';
import { compressVideoReferences } from './videoReferences.mjs';
import { buildSeedanceBody } from './seedance.mjs';
import { createVideoQueue } from './videoQueue.mjs';
import { createJobStore } from './store/jobs.mjs';
import { createWorkStore } from './store/works.mjs';
import { createSpendLog } from './store/spend.mjs';
import { solidPng } from './png.mjs';
import { wav } from './fixtures/wav.mjs';
import { tempDir, waitFor } from './testKit.mjs';

const png = { kind: 'image', contentType: 'image/png', buffer: solidPng(4, 3, [0, 0, 0]) };
const jpegHeader = Buffer.from([255, 216, 255, 192, 0, 17, 8, 0, 3, 0, 4, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217]);
const sound = seconds => ({ kind: 'audio', contentType: 'audio/wav', buffer: wav(seconds), duration: seconds, bytes: wav(seconds).length });
const model = 'doubao-seedance-2-0-mini-260615';
const request = (images = [png], audios = []) => ({ model, images, audios });

test('PNG转得更大就原样返回；无需转换的媒体和asset引用不运行ffmpeg，不建临时文件', async () => {
  const root = tempDir(), calls = [];
  const executor = { run: async (cmd, args) => {
    calls.push({ cmd, args }); writeFileSync(args.at(-1), Buffer.alloc(1000));
  } };
  const unchanged = [{ ...png, contentType: 'image/jpeg', buffer: Buffer.from([255, 216, 255]) },
    { ...png, contentType: 'image/webp', buffer: Buffer.from('RIFF0000WEBP') }, { asset: 'person-1' }];
  const mp3 = { kind: 'audio', contentType: 'audio/mpeg', buffer: Buffer.from('original mp3') };
  const result = await compressVideoReferences(request([png, ...unchanged], [mp3]), { executor, tempRoot: root });
  assert.equal(calls.length, 1); assert.equal(calls[0].cmd, 'ffmpeg');
  assert.deepEqual(calls[0].args.slice(calls[0].args.indexOf('-q:v'), calls[0].args.indexOf('-q:v') + 2), ['-q:v', '2']);
  assert.equal(result.images[0], png);
  unchanged.forEach((asset, index) => assert.equal(result.images[index + 1], asset));
  assert.equal(result.audios[0], mp3);
  assert.deepEqual(readdirSync(root), []);
});

test('转换失败和ffmpeg缺失：原件照发，单子成功，每次记一行原因且清掉临时文件', async () => {
  for (const error of [Error('conversion failed'), Object.assign(Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' })]) {
    const root = tempDir(), logs = [], storeRoot = tempDir(), jobs = createJobStore(storeRoot);
    const works = createWorkStore(storeRoot), spend = createSpendLog(storeRoot);
    const audio = works.addAudio(wav(2)), image = works.add(png.buffer, {}), asset = works.read(audio.id);
    const executor = { run: async (cmd, args) => {
      assert.equal(existsSync(args[args.indexOf('-i') + 1]), true);
      writeFileSync(args.at(-1), 'partial'); throw error;
    } };
    let body, submitted = 0;
    const queue = createVideoQueue({ jobs, works, spend,
      compressReferences: value => compressVideoReferences(value, { executor, tempRoot: root, log: line => logs.push(line) }),
      client: { submit: async value => { submitted++; body = buildSeedanceBody(value); return { ok: true, taskId: 'fallback' }; },
        query: async () => ({ status: 'succeeded', content: { video_url: 'https://fake/video' } }),
        download: async () => readFileSync(new URL('./fixtures/fake-video.mp4', import.meta.url)) } });
    const job = queue.submit({ model, resolution: '480p', priceYuan: 1,
      refs: [{ type: 'work', id: audio.id }, { type: 'work', id: image.id }] });
    await waitFor(() => ['succeeded', 'failed', 'uncertain'].includes(jobs.read(job.id).status));
    assert.equal(submitted, 1); assert.equal(jobs.read(job.id).taskId, 'fallback');
    assert.equal(jobs.read(job.id).status, 'succeeded');
    assert.equal(body.content[1].image_url.url, `data:image/png;base64,${png.buffer.toString('base64')}`);
    assert.equal(body.content.at(-1).audio_url.url, `data:audio/wav;base64,${asset.buffer.toString('base64')}`);
    assert.equal(logs.length, 2);
    for (const line of logs) {
      assert.match(line, /原文件/);
      assert.match(line, error.code === 'ENOENT' ? /ENOENT/ : /conversion failed/);
      assert.equal(line.split('\n').length, 1);
    }
    assert.deepEqual(readdirSync(root), []);
  }
});

function audioExecutor(durations, outputs = []) {
  let index = 0;
  return { run: async (cmd, args) => {
    if (cmd === 'ffprobe') return { stdout: JSON.stringify({ format: { duration: durations[index++] } }) };
    assert.equal(cmd, 'ffmpeg');
    assert.deepEqual(args.slice(args.indexOf('-b:a'), args.indexOf('-b:a') + 2), ['-b:a', '192k']);
    const bytes = Buffer.from('encoded mp3'); outputs.push(bytes);
    writeFileSync(args.at(-1), bytes);
  } };
}

test('MP3补帧超过单段或总时长上限就回退WAV；安全的段转MP3并保留原始元数据', async () => {
  for (const [seconds, encoded, expectedTypes] of [
    [[15], ['15.024'], ['audio/wav']],
    [[7.5, 7.5], ['7.536', '7.536'], ['audio/wav', 'audio/wav']],
    [[7.4, 7.5], ['7.44', '7.536'], ['audio/mpeg', 'audio/mpeg']]
  ]) {
    const root = tempDir(), originals = seconds.map(sound), logs = [];
    const result = await compressVideoReferences(request([], originals), {
      executor: audioExecutor(encoded), tempRoot: root, log: line => logs.push(line)
    });
    assert.deepEqual(result.audios.map(asset => asset.contentType), expectedTypes);
    assert.deepEqual(result.audios.map(asset => asset.duration), seconds);
    result.audios.forEach((asset, index) => {
      if (asset.contentType === 'audio/wav') assert.equal(asset, originals[index]);
      else assert.equal(asset.bytes, asset.buffer.length);
    });
    assert.equal(logs.length, expectedTypes.filter(type => type === 'audio/wav').length);
    assert.deepEqual(readdirSync(root), []);
  }
});

test('MP3变大、探测失败或无有效时长都使用原WAV，不留下中间文件', async () => {
  for (const mode of ['larger', 'probe-error', 'invalid']) {
    const root = tempDir(), original = sound(2), logs = [];
    const executor = { run: async (cmd, args) => {
      if (cmd === 'ffprobe') {
        if (mode === 'probe-error') throw Error('ffprobe missing');
        return { stdout: JSON.stringify({ format: { duration: 'NaN' } }) };
      }
      writeFileSync(args.at(-1), Buffer.alloc(mode === 'larger' ? original.buffer.length + 1 : 100));
    } };
    const result = await compressVideoReferences(request([], [original]), { executor, tempRoot: root, log: line => logs.push(line) });
    assert.equal(result.audios[0], original);
    assert.deepEqual(readdirSync(root), []);
    if (mode !== 'larger') assert.equal(logs.length, 1);
  }
});

test('同批参考各用独立临时目录，成功后已经删除；不改调用方对象', async () => {
  const root = tempDir(), folders = [], images = [png, png];
  const executor = { run: async (cmd, args) => {
    const input = args[args.indexOf('-i') + 1]; folders.push(dirname(input));
    assert.deepEqual(readFileSync(input), png.buffer);
    writeFileSync(args.at(-1), jpegHeader);
  } };
  const original = request(images), result = await compressVideoReferences(original, { executor, tempRoot: root });
  assert.equal(new Set(folders).size, 2);
  folders.forEach(folder => assert.equal(existsSync(folder), false));
  assert.equal(original.images, images); assert.equal(images[0], png);
  assert.equal(result.images[0].contentType, 'image/jpeg');
  assert.deepEqual(readdirSync(root), []);
});

test('真实ffmpeg：普通WAV转MP3，15秒边界发出的MP3实测不超限，临时目录清空', async () => {
  const executor = createExecutor();
  try {
    for (const seconds of [2, 15]) {
      const root = tempDir(), logs = [], original = sound(seconds);
      const result = await compressVideoReferences(request([], [original]), { tempRoot: root, log: line => logs.push(line) });
      if (result.audios[0] === original) {
        assert.equal(seconds, 15, '普通2秒音频必须转成功');
        assert.equal(logs.length, 1);
        assert.match(logs[0], /补帧.*时长上限/);
      } else {
        assert.equal(result.audios[0].contentType, 'audio/mpeg');
        assert.ok(result.audios[0].buffer.length < original.buffer.length);
        const file = join(tempDir(), 'sent.mp3'); writeFileSync(file, result.audios[0].buffer);
        const probe = await executor.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
        const duration = Number(JSON.parse(probe.stdout).format.duration);
        assert.ok(duration > 0 && duration <= 15, `MP3 实测时长 ${duration} 不应超限`);
        assert.equal(logs.length, 0);
      }
      assert.deepEqual(readdirSync(root), []);
    }
  } finally { executor.stop(); }
});
