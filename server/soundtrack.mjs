// 改写成片配回原视频的声音（10-30 用户定）：成片关着「生成音频」出，出好后本机 ffmpeg 合成，不花钱。
// 画面原样拷贝不重编码，声音转 AAC；长度按成片和原视频较短的那个截齐（多出来的尾巴没有参考，本来就是 AI 编的）。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutor } from './depth/executor.mjs';
import { parseMp4, readMp4File } from './mp4.mjs';

export async function addSoundtrack(video, sourcePath, { executor, tempRoot = tmpdir() } = {}) {
  const made = parseMp4(video);
  if (!made || !(made.duration > 0)) throw Error('成片读不出时长');
  const source = readMp4File(sourcePath);
  if (!source?.hasAudio) throw Error('原视频没有声音');
  const seconds = Math.min(made.duration, source.duration);
  const folder = mkdtempSync(join(tempRoot, 'soundtrack-'));
  try {
    const input = join(folder, 'video.mp4'), output = join(folder, 'output.mp4');
    writeFileSync(input, video);
    await (executor ?? createExecutor()).run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', input, '-i', sourcePath,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', seconds.toFixed(3), '-movflags', '+faststart', output]);
    const buffer = readFileSync(output);
    const mixed = parseMp4(buffer);
    if (!mixed?.hasAudio || mixed.width !== made.width || mixed.height !== made.height) throw Error('配声结果没有声音或宽高变了');
    return buffer;
  } finally {
    rmSync(folder, { recursive: true, force: true, maxRetries: 3 });
  }
}
