import { join } from 'node:path';
import { readMp4File } from '../mp4.mjs';

/** 不限制原片时长；容差只用于来源元数据末尾的舍入差。 */
export function clipRange(meta, start, end) {
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) {
    throw Error('截取的开始和结束时间必须是有限数字。');
  }
  if (start < 0) throw Error('截取的开始时间不能小于 0。');
  if (!Number.isFinite(meta.duration) || end - meta.duration > 0.010000001) throw Error('截取的结束时间不能超过视频时长。');
  if (Math.min(meta.duration, end) - start < 1 - 1e-9) throw Error('截取的片段至少要 1 秒。');
  const stop = Math.min(meta.videoDuration ?? meta.duration, meta.duration, end);
  if (start >= stop) throw Error('选中的片段没有画面，请调整截取的开始时间。');
  return { start, end: stop };
}

/** 保留ffmpeg默认自动旋转，缩放以旋转后的画面为准；从文件校验和保存大视频。 */
export function createVideoClip({ checkSource, temporary, executor, uploads }) {
  return async job => {
    const meta = checkSource(job.source), range = clipRange(meta, job.start, job.end);
    if (!(meta.fps > 0 && Number.isFinite(meta.fps))) throw Error('原视频读不出帧率。');
    return temporary(async folder => {
      const output = join(folder, 'clip.mp4'), duration = range.end - range.start;
      // tkhd宽高是显示尺寸；自动旋转后的dar含SAR，用显示面积恢复对应方向的方形像素宽高。
      const area = meta.width * meta.height;
      const geometry = `scale=trunc((sqrt(${area}*dar)+0.000001)/2)*2:trunc((sqrt(${area}/dar)+0.000001)/2)*2,setsar=1`;
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-i', meta.path, '-ss', String(range.start), '-t', String(duration),
        '-map', '0:v:0', ...(meta.hasAudio ? ['-map', '0:a:0', '-af', `apad=whole_dur=${range.end}`, '-c:a', 'aac'] : ['-an']),
        '-vf', geometry, '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-r', String(meta.fps), '-fps_mode', 'cfr', '-movflags', '+faststart', output]);
      const video = readMp4File(output);
      if (!video || video.kind !== 'video') throw Error('截取输出不是有效视频，没有保存。');
      if ([video.duration, video.videoDuration].some(seconds => !Number.isFinite(seconds) || Math.abs(seconds - duration) > 1 / meta.fps + 0.05)
        || video.fps === null || Math.abs(video.fps - meta.fps) > 0.001) {
        throw Error('截取输出的时长或帧率不对，没有保存。');
      }
      if (meta.hasAudio && !video.hasAudio) throw Error('截取输出丢失声音轨，没有保存。');
      const saved = uploads.saveFile(output);
      if (!saved || saved.kind !== 'video') throw Error('截取输出不是有效视频，没有保存。');
      return saved;
    });
  };
}
