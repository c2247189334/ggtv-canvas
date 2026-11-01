import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addSoundtrack } from './soundtrack.mjs';
import { parseMp4 } from './mp4.mjs';
import { tempDir } from './testKit.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const silent = readFileSync(fixture('fake-video.mp4'));
const cut = (from, seconds, folder) => {
  const output = join(folder, `cut-${seconds}.mp4`);
  execFileSync('ffmpeg', ['-v', 'error', '-nostdin', '-i', from, '-t', String(seconds), '-c', 'copy', output]);
  return output;
};

test('真 ffmpeg：无声成片配上原视频的声音，画面宽高不变，临时文件删干净', async () => {
  const temp = tempDir();
  const output = parseMp4(await addSoundtrack(silent, fixture('audio-video.mp4'), { tempRoot: temp }));
  assert.equal(output.hasAudio, true);
  assert.deepEqual([output.width, output.height], [320, 180]);
  assert.ok(Math.abs(output.duration - 2) < 0.1, `时长 ${output.duration}`);
  assert.deepEqual(readdirSync(temp), []);
});

// 画面不重编码只能截在数据包边界，会多出零点几秒（10-30 真成片 9.69 秒截出 9.79）；这里只管没留下 2 秒的长尾。
const nearOneSecond = seconds => seconds >= 0.95 && seconds < 1.3;
test('长度按成片和原视频较短的那个截齐', async () => {
  const folder = tempDir();
  const shortSource = parseMp4(await addSoundtrack(silent, cut(fixture('audio-video.mp4'), 1, folder), { tempRoot: tempDir() }));
  assert.ok(nearOneSecond(shortSource.duration), `原视频短：${shortSource.duration}`);
  const shortVideo = parseMp4(await addSoundtrack(readFileSync(cut(fixture('fake-video.mp4'), 1, folder)), fixture('audio-video.mp4'), { tempRoot: tempDir() }));
  assert.ok(nearOneSecond(shortVideo.duration), `成片短：${shortVideo.duration}`);
  assert.equal(shortVideo.hasAudio, true);
});

test('原视频没有声音、成片读不出来都直接报错，临时文件照样删', async () => {
  const temp = tempDir();
  await assert.rejects(addSoundtrack(silent, fixture('depth-video.mp4'), { tempRoot: temp }), /没有声音/);
  await assert.rejects(addSoundtrack(Buffer.from('not mp4'), fixture('audio-video.mp4'), { tempRoot: temp }), /成片/);
  assert.deepEqual(readdirSync(temp), []);
});
