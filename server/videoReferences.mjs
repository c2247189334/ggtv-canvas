// 仅视频交单使用：压缩发出的副本，作品/上传原件永不改写。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutor } from './depth/executor.mjs';
import { imageTypeOf } from './store/uploads.mjs';
import { imageSize } from './imageSize.mjs';
import { parseWav } from './wav.mjs';
import { videoModelOf } from './videoModels.mjs';

const whiteBackground = '[0:v]format=rgba,split[fg][bg];[bg]drawbox=color=white:t=fill:replace=1[white];' +
  '[white][fg]overlay=shortest=1:format=auto,format=yuvj444p[out]';

export async function compressVideoReferences(request, { executor, tempRoot = tmpdir(), log = console.error } = {}) {
  const runner = executor ?? createExecutor();
  const warn = (type, error) => log(`[视频交单] ${type}转换未使用，使用原文件：${String(error?.message ?? error).replace(/[\r\n]+/g, ' ').slice(0, 500)}`);
  const model = videoModelOf(request.model);
  let audioTotal = (request.audios ?? []).reduce((sum, asset) => sum + asset.duration, 0);

  async function convert(asset, audio = false) {
    if (asset.asset || (audio ? asset.contentType !== 'audio/wav' : imageTypeOf(asset.buffer)?.ext !== 'png')) return asset;
    let folder;
    const type = audio ? 'WAV → MP3' : 'PNG → JPG';
    try {
      const originalSize = audio ? null : imageSize(asset.buffer);
      const originalAudio = audio ? parseWav(asset.buffer) : null;
      if (audio ? !originalAudio : !originalSize) throw Error('原文件元数据无法识别');
      folder = mkdtempSync(join(tempRoot, 'seedance-ref-'));
      const input = join(folder, audio ? 'input.wav' : 'input.png');
      const output = join(folder, audio ? 'output.mp3' : 'output.jpg');
      writeFileSync(input, asset.buffer);
      await runner.run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', input,
        ...(audio ? ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'] :
          ['-filter_complex_threads', '1', '-filter_complex', whiteBackground, '-map', '[out]', '-frames:v', '1', '-q:v', '2']), output]);
      const buffer = readFileSync(output);
      if (buffer.length >= asset.buffer.length) return asset;
      if (buffer.length === 0) throw Error('转换结果为空');
      if (audio) {
        // 容器时长包含 MP3 补帧。边界上宁可发原 WAV，也不裁声音或放宽时长校验。
        const probe = await runner.run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', output]);
        const seconds = Number(JSON.parse(probe.stdout)?.format?.duration);
        if (!Number.isFinite(seconds) || seconds <= 0) throw Error('MP3 时长无法识别');
        const nextTotal = audioTotal - asset.duration + seconds;
        if (seconds > (model?.maxAudioSeconds ?? Infinity) || nextTotal > (model?.maxAudioTotal ?? Infinity)) {
          throw Error('MP3 补帧后超过参考音频时长上限');
        }
        audioTotal = nextTotal;
      } else {
        const size = imageSize(buffer);
        if (imageTypeOf(buffer)?.ext !== 'jpg' || size?.width !== originalSize.width || size?.height !== originalSize.height) {
          throw Error('JPG 输出格式或宽高不符');
        }
      }
      return { ...asset, buffer, bytes: buffer.length, contentType: audio ? 'audio/mpeg' : 'image/jpeg' };
    } catch (error) {
      warn(type, error);
      return asset;
    } finally {
      if (folder) {
        try { rmSync(folder, { recursive: true, force: true, maxRetries: 3 }); }
        catch (error) { warn(`${type} 临时目录清理`, error); }
      }
    }
  }

  try {
    const images = [], audios = [];
    for (const asset of request.images ?? []) images.push(await convert(asset));
    for (const asset of request.audios ?? []) audios.push(await convert(asset, true));
    return { ...request, images, audios };
  } finally { if (!executor) runner.stop(); }
}
