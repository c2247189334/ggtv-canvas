import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSheets } from './sheets.mjs';
import { tempDir } from '../testKit.mjs';
import { createExecutor } from '../depth/executor.mjs';

const recorder = () => {
  const calls = [];
  const sheets = createSheets({ platform: 'win32', env: { WINDIR: "Z:\\John's\\Windows" }, exists: () => true,
    executor: { run: async (cmd, args) => { calls.push({ cmd, args }); return { stderr: 'pts_time:5.5 pts_time:9' }; } } });
  const arg = (call, name) => call.args[call.args.indexOf(name) + 1];
  return { calls, sheets, arg };
};

test('10-26 一轮版：整条每0.2秒一帧拼一张大图，每行10帧，竖屏帧宽240，明确字体并转义路径', async () => {
  const { calls, sheets, arg } = recorder();
  const result = await sheets.timeline({ source: 'source.mp4', folder: tempDir(), duration: 15.047, width: 720, height: 1280 });
  assert.deepEqual(result, ['timeline-0.jpg']);
  assert.equal(calls.length, 1);
  const filter = arg(calls[0], '-vf');
  assert.match(filter, /fps=5/); assert.match(filter, /scale=240:-2/); assert.match(filter, /tile=10x8:nb_frames=76/);
  assert.ok(filter.includes("fontfile='Z\\:/John\\'s/Windows/Fonts/arial.ttf'"));
  assert.equal(arg(calls[0], '-ss'), '0'); assert.equal(arg(calls[0], '-t'), '15.047');
  assert.deepEqual(await sheets.cuts('source.mp4', 15.05), [5.5, 9]);
});

test('超过80帧均分成几张、每张不超过80帧（在最高清晰度约900万像素内）；横屏按面积放宽帧宽', async () => {
  const thirty = recorder();
  assert.deepEqual(await thirty.sheets.timeline({ source: 's.mp4', folder: tempDir(), duration: 30, width: 720, height: 1280 }),
    ['timeline-0.jpg', 'timeline-1.jpg']);
  assert.deepEqual(thirty.calls.map(call => [thirty.arg(call, '-ss'), thirty.arg(call, '-t')]), [['0', '15'], ['15', '15']]);
  assert.ok(thirty.calls.every(call => /tile=10x8:nb_frames=75/.test(thirty.arg(call, '-vf'))));
  const tail = recorder();
  await tail.sheets.timeline({ source: 's.mp4', folder: tempDir(), duration: 16.05, width: 720, height: 1280 });
  assert.deepEqual(tail.calls.map(call => tail.arg(call, '-vf').match(/nb_frames=(\d+)/)[1]), ['41', '40'], '不留只有一帧的尾巴图');
  const wide = recorder();
  await wide.sheets.timeline({ source: 's.mp4', folder: tempDir(), duration: 4, width: 864, height: 480 });
  assert.match(wide.arg(wide.calls[0], '-vf'), /scale=430:-2.*tile=10x2:nb_frames=20/);
});

test('10-30 清楚大帧：按给的秒数各截一张原片帧，长边最多 1920、不放大，不印字', async () => {
  const { calls, sheets, arg } = recorder();
  assert.deepEqual(await sheets.frames({ source: 's.mp4', folder: tempDir() }, [1.3, 3.8]), ['frame-0.jpg', 'frame-1.jpg']);
  assert.deepEqual(calls.map(call => [arg(call, '-ss'), arg(call, '-frames:v')]), [['1.3', '1'], ['3.8', '1']]);
  assert.equal(arg(calls[0], '-vf'), "scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease");
  assert.ok(calls[0].args.at(-1).endsWith('frame-0.jpg'));
});

test('11-11 连拍：整条每 0.5 秒一帧、每张 6×2 帧，最后一张照剩下的帧数拼；换点前后每 0.2 秒一帧一行 7 帧，回每张的起止秒数', async () => {
  const { calls, sheets, arg } = recorder();
  assert.deepEqual(await sheets.contact({ source: 's.mp4', folder: tempDir() }, { end: 15.115, prefix: 'all' }), [
    { name: 'all-0.jpg', from: 0, to: 5.5 }, { name: 'all-1.jpg', from: 6, to: 11.5 }, { name: 'all-2.jpg', from: 12, to: 15 }]);
  assert.deepEqual(calls.map(call => [arg(call, '-ss'), arg(call, '-t')]), [['0', '6'], ['6', '6'], ['12', '3.5']]);
  assert.match(arg(calls[0], '-vf'), /fps=2:start_time=0.*scale=w='trunc\(sqrt\(129600\*iw\/ih\)\/2\)\*2':h=-2.*tile=6x2:nb_frames=12/);
  assert.match(arg(calls[2], '-vf'), /tile=6x2:nb_frames=7/);
  const strip = recorder();
  assert.deepEqual(await strip.sheets.contact({ source: 's.mp4', folder: tempDir() }, { start: 5.2, end: 6.6, step: 0.2, columns: 7, rows: 1, prefix: 'change0' }),
    [{ name: 'change0-0.jpg', from: 5.2, to: 6.4 }]);
  assert.match(strip.arg(strip.calls[0], '-vf'), /fps=5:start_time=0.*tile=7x1:nb_frames=7/);
  assert.equal(strip.arg(strip.calls[0], '-t'), '1.4');
});

test('字体文件不存在先报人话，不调用执行器', async () => {
  let calls = 0;
  const sheets = createSheets({ exists: () => false, executor: { run: async () => { calls++; } } });
  await assert.rejects(sheets.timeline({ source: 's.mp4', folder: tempDir(), duration: 4, width: 720, height: 1280 }), /找不到.*字体/);
  assert.equal(calls, 0);
});

test('真ffmpeg处理audio-video.mp4：生成一张带时间的大图，宽高照帧数拼出，没有切点', async () => {
  const folder = tempDir(), executor = createExecutor(), source = fileURLToPath(new URL('../fixtures/audio-video.mp4', import.meta.url));
  const sheets = createSheets({ executor });
  const files = await sheets.timeline({ source, folder, duration: 2, width: 864, height: 480 });
  assert.deepEqual(files, ['timeline-0.jpg']);
  assert.equal(readFileSync(join(folder, files[0])).subarray(0, 2).toString('hex'), 'ffd8');
  const { stderr } = await executor.run('ffmpeg', ['-hide_banner', '-i', join(folder, files[0]), '-f', 'null', '-']);
  const [, width, height] = stderr.match(/Video: .*?, (\d+)x(\d+)/) ?? [];
  assert.equal(Number(width), 3 + 10 * (430 + 3), '10 帧一行：430 宽加间距');
  assert.equal(Number(height), 3 + 238 + 3, '2 秒 10 帧刚好一行');
  assert.ok(existsSync(join(folder, files[0])));
  assert.deepEqual(await sheets.cuts(source, 2), []);
  const [frame] = await sheets.frames({ source, folder }, [1]);
  const probe = await executor.run('ffmpeg', ['-hide_banner', '-i', join(folder, frame), '-f', 'null', '-']);
  assert.match(probe.stderr, /Video: .*?, 864x480/, '原片 864×480 不放大');
  const [burst] = await sheets.contact({ source, folder }, { end: 2, prefix: 'all' });
  assert.deepEqual([burst.from, burst.to], [0, 1.5]);
  const shot = await executor.run('ffmpeg', ['-hide_banner', '-i', join(folder, burst.name), '-f', 'null', '-']);
  const [, burstWidth, burstHeight] = shot.stderr.match(/Video: .*?, (\d+)x(\d+)/) ?? [];
  assert.equal(Number(burstWidth), 3 + 6 * (482 + 3), '横屏按面积 270×480 定帧宽 482，一行 6 格');
  assert.ok(Number(burstHeight) > 260 && Number(burstHeight) < 280, `2 秒 4 帧一行，实际高 ${burstHeight}`);
});

test('真ffmpeg非方形像素（存192×320、显示384×320）：拼图每帧和清楚大帧都按显示比例转成方形像素', async () => {
  const folder = tempDir(), executor = createExecutor(), source = join(folder, 'sar2.mp4');
  await executor.run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=192x320:rate=10:duration=1', '-vf', 'setsar=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  const sheets = createSheets({ executor });
  const [sheet] = await sheets.timeline({ source, folder, duration: 1, width: 384, height: 320 });
  const size = async file => (await executor.run('ffmpeg', ['-hide_banner', '-i', join(folder, file), '-f', 'null', '-']))
    .stderr.match(/Video: .*?, (\d+)x(\d+)/).slice(1).map(Number);
  const frameWidth = 2 * Math.round(Math.sqrt(320 * 320 * 384 / 320) / 2);
  assert.deepEqual(await size(sheet), [3 + 10 * (frameWidth + 3), 3 + 2 * Math.round(frameWidth * 320 / 384 / 2) + 3]);
  const [frame] = await sheets.frames({ source, folder }, [0.5]);
  assert.deepEqual(await size(frame), [384, 320]);
});

test('11-09 真ffmpeg量一帧最亮的像素：前半秒纯黑低于 40，后半秒白底高于 200（背景帧兜底判黑屏用）', async () => {
  const folder = tempDir(), executor = createExecutor(), source = join(folder, 'fade.mp4');
  await executor.run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:r=10:d=0.5', '-f', 'lavfi', '-i', 'color=c=white:s=320x240:r=10:d=0.5',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  const sheets = createSheets({ executor });
  assert.ok((await sheets.peak({ source }, 0.1)) < 40);
  assert.ok((await sheets.peak({ source }, 0.8)) > 200);
});

test('11-09 量亮度读不出数字回 null，不当成黑屏', async () => {
  const { sheets, calls, arg } = recorder();
  assert.equal(await sheets.peak({ source: 'clip.mp4' }, 2.4), null);
  assert.equal(arg(calls[0], '-ss'), '2.4');
  assert.match(arg(calls[0], '-vf'), /signalstats/);
});
