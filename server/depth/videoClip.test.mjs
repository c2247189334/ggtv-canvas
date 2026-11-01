import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLocalMedia } from './local.mjs';
import { createExecutor } from './executor.mjs';
import { createUploadStore } from '../store/uploads.mjs';
import { createWorkStore } from '../store/works.mjs';
import { readMp4File } from '../mp4.mjs';
import { clipRange } from './videoClip.mjs';
import { tempDir } from '../testKit.mjs';

const fixture = name => readFileSync(new URL(`../fixtures/${name}.mp4`, import.meta.url));

test('画面先结束时截到画面末尾，完全没有画面的尾巴在执行前拒绝', () => {
  const meta = { duration: 4, videoDuration: 2 };
  assert.deepEqual(clipRange(meta, 0.5, 3.5), { start: 0.5, end: 2 });
  assert.deepEqual(clipRange(meta, 1.5, 3.5), { start: 1.5, end: 2 });
  assert.throws(() => clipRange(meta, 2.5, 4), /选中的片段没有画面.*调整.*开始/);
});

for (const [videoSeconds, audioSeconds, start, end, seconds] of [[2, 4, 0.5, 3.5, 1.5], [4, 1, 2, 3.5, 1.5]]) {
test(`真实ffmpeg：长短音轨尾部 ${videoSeconds}/${audioSeconds} 秒保留完整画面和足长音轨`, async () => {
  const executor = createExecutor(), folder = tempDir();
  try {
      const input = join(folder, `tracks-${videoSeconds}-${audioSeconds}.mp4`);
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i',
        `testsrc2=size=160x120:rate=25:duration=${videoSeconds}`, '-f', 'lavfi', '-i',
        `sine=frequency=440:sample_rate=48000:duration=${audioSeconds}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', input]);
      const s = setup(executor), source = { type: 'upload', id: s.uploads.saveFile(input).id };
      const clip = await s.media.clip({ source, start, end });
      const output = s.uploads.path(clip.id), video = readMp4File(output);
      assert.equal(video.hasAudio, true);
      assert.ok(Math.abs(video.videoDuration - seconds) <= 1 / 25, JSON.stringify(video));
      assert.ok(Math.abs(video.duration - seconds) <= 1 / 25 + 0.03, JSON.stringify(video));
      const { stdout } = await executor.run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=duration', '-of', 'json', output]);
      assert.ok(Math.abs(Number(JSON.parse(stdout).streams[0].duration) - seconds) <= 0.03, stdout);
      if (audioSeconds < start) {
        const { stderr } = await executor.run('ffmpeg', ['-hide_banner', '-i', output, '-vn', '-af', 'volumedetect', '-f', 'null', '-']);
        const maximum = Number(stderr.match(/max_volume:\s*([-\d.]+)/)?.[1]);
        assert.ok(maximum < -80, stderr);
      }
  } finally { executor.stop(); }
});
}
test('截取输出的总时长够但画面提前结束也拒收，不把音轨尾巴当完整画面', async () => {
  const executor = createExecutor(), folder = tempDir();
  try {
    const sourcePath = join(folder, 'source.mp4'), badOutput = join(folder, 'truncated-picture.mp4');
    for (const [path, duration] of [[sourcePath, 4], [badOutput, 2]]) {
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', `testsrc2=size=160x120:rate=25:duration=${duration}`,
        '-f', 'lavfi', '-i', 'sine=duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', path]);
    }
    const bytes = readFileSync(badOutput), s = setup({ run: async (_command, args) => writeFileSync(args.at(-1), bytes), stop: () => {} });
    const source = { type: 'upload', id: s.uploads.saveFile(sourcePath).id };
    await assert.rejects(s.media.clip({ source, start: 0, end: 4 }), /截取输出的时长或帧率不对/);
    assert.equal(s.uploads.ids().length, 2);
  } finally { executor.stop(); }
});
function setup(executor, fake = true) {
  const dataRoot = tempDir(), uploads = createUploadStore(dataRoot), works = createWorkStore(dataRoot);
  const source = { type: 'upload', id: uploads.save(fixture('audio-video')).id };
  return { dataRoot, uploads, works, source, media: createLocalMedia({ dataRoot, uploads, works, executor, fake }) };
}

test('截取的非法来源和范围直接拒收，执行器没有被调用', async () => {
  let calls = 0;
  const s = setup({ run: async () => { calls++; }, stop: () => {} });
  for (const source of [null, { type: 'url', id: s.source.id }, { type: 'upload', id: '../x' },
    { type: 'upload', id: '00000000-0000-4000-8000-000000000000' }]) {
    await assert.rejects(s.media.clip({ source, start: 0, end: 1 }), /视频来源|找不到/);
  }
  for (const [start, end, message] of [[NaN, 1, /有限数字/], [0, Infinity, /有限数字/], ['0', 1, /有限数字/],
    [-1, 1, /不能小于 0/], [0, 2.02, /超过视频时长/], [0.5, 1.4, /截取的片段至少要 1 秒。/], [1, 0, /至少要 1 秒/],
    [1.009, 2.009, /截取的片段至少要 1 秒。/]]) {
    await assert.rejects(s.media.clip({ source: s.source, start, end }), message);
  }
  assert.equal(calls, 0);
  assert.equal(existsSync(join(s.dataRoot, 'processing')), false);
});

test('真实ffmpeg：精确截0.4~1.6、有/无音轨、上传素材与临时目录清理；假模式也调用ffmpeg', async () => {
  const executor = createExecutor();
  try {
    for (const name of ['audio-video', 'depth-video']) {
      const s = setup(executor);
      const source = { type: 'upload', id: s.uploads.save(fixture(name)).id };
      const saved = await s.media.clip({ source, start: 0.4, end: 1.6 });
      assert.equal(saved.kind, 'video');
      assert.equal(saved.width, 864); assert.equal(saved.height, 480); assert.equal(saved.fps, 30);
      assert.equal(saved.hasAudio, name === 'audio-video');
      assert.ok(Math.abs(saved.duration - 1.2) <= 1 / 30 + 0.05, String(saved.duration));
      assert.deepEqual(readMp4File(s.uploads.path(saved.id)).hasAudio, saved.hasAudio);
      assert.equal(s.works.list().length, 0);
      assert.deepEqual(readdirSync(join(s.dataRoot, 'processing')), []);
    }
  } finally { executor.stop(); }
});

test('输出无效、时长错、丢音轨或执行失败都不保存，报localError原话且清临时目录', async () => {
  for (const mode of ['invalid', 'duration', 'audio', 'throw']) {
    const executor = { run: async (_cmd, args) => {
      if (mode === 'throw') throw Error('测试执行失败');
      writeFileSync(args.at(-1), mode === 'invalid' ? Buffer.from('bad') : fixture(mode === 'audio' ? 'depth-video' : 'audio-video'));
    }, stop: () => {} };
    const s = setup(executor);
    await assert.rejects(s.media.clip({ source: s.source, start: mode === 'audio' ? 0 : 0.4, end: mode === 'audio' ? 2 : 1.6 }),
      new RegExp(`本地处理失败[\\s\\S]*${mode === 'throw' ? '测试执行失败' : mode === 'invalid' ? '有效视频' : mode === 'audio' ? '声音轨' : '时长'}`));
    assert.equal(s.uploads.ids().length, 1);
    assert.deepEqual(readdirSync(join(s.dataRoot, 'processing')), []);
  }
});

test('真实ffmpeg：带旋转矩阵的横编码视频按原片显示方向输出；奇数宽高向下取偶且保留帧率', async () => {
  const executor = createExecutor(), folder = tempDir();
  try {
    const rotated = join(folder, 'rotated.mp4');
    // 写入标准tkhd显示矩阵；ffmpeg8的metadata rotate标签不再生成此矩阵。
    const bytes = fixture('audio-video'), matrix = bytes.indexOf(Buffer.from('tkhd')) + 4 + 40;
    [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824].forEach((value, index) => bytes.writeInt32BE(value, matrix + index * 4));
    writeFileSync(rotated, bytes);
    const probe = file => executor.run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream_side_data=rotation', '-of', 'json', file]);
    const inputInfo = JSON.parse((await probe(rotated)).stdout);
    assert.equal(Math.abs(inputInfo.streams[0].side_data_list[0].rotation), 90);
    const s = setup(executor);
    const source = { type: 'upload', id: s.uploads.save(readFileSync(rotated)).id };
    const clip = await s.media.clip({ source, start: 0.4, end: 1.6 });
    assert.equal(clip.width, 480); assert.equal(clip.height, 864); assert.equal(clip.fps, 30);
    const output = await probe(s.uploads.path(clip.id));
    const rotations = JSON.parse(output.stdout).streams.flatMap(stream => stream.side_data_list ?? []);
    assert.ok(rotations.every(side => !side.rotation), output.stdout);
    const odd = join(folder, 'odd.mp4');
    await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc=size=865x481:rate=24',
      '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv444p', odd]);
    const oddSource = { type: 'upload', id: s.uploads.save(readFileSync(odd)).id };
    const even = await s.media.clip({ source: oddSource, start: 0, end: 1.5 });
    assert.equal(even.width, 864); assert.equal(even.height, 480); assert.equal(even.fps, 24);
  } finally { executor.stop(); }
});

test('真实ffmpeg：非方形像素按原片显示宽高取偶，旋转后保留显示比例和显示尺寸', async () => {
  const executor = createExecutor(), folder = tempDir();
  try {
    for (const [sar, width] of [['4/3', 960], ['3/4', 540]]) {
      const input = join(folder, `sar-${width}.mp4`);
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-f', 'lavfi', '-i', 'testsrc2=size=720x480:rate=24',
        '-t', '2', '-vf', `setsar=${sar}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', input]);
      const s = setup(executor), bytes = readFileSync(input);
      for (const rotate of [false, true]) {
        const copy = Buffer.from(bytes);
        if (rotate) {
          const matrix = copy.indexOf(Buffer.from('tkhd')) + 4 + 40;
          [0, 65536, 0, -65536, 0, 0, 0, 0, 1073741824].forEach((value, index) => copy.writeInt32BE(value, matrix + index * 4));
        }
        const source = { type: 'upload', id: s.uploads.save(copy).id };
        const meta = s.uploads.metadata(source.id);
        // 10-31 起元数据按旋转后的显示方向记（手机竖拍的旋转标记）。
        assert.equal(meta.width, rotate ? 480 : width); assert.equal(meta.height, rotate ? width : 480);
        const clip = await s.media.clip({ source, start: 0.4, end: 1.6 });
        assert.equal(clip.width, rotate ? 480 : width, `${sar}, rotate=${rotate}`);
        assert.equal(clip.height, rotate ? width : 480, `${sar}, rotate=${rotate}`);
        assert.equal(clip.fps, 24);
      }
    }
  } finally { executor.stop(); }
});
