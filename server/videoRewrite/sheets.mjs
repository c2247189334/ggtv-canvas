import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createExecutor } from '../depth/executor.mjs';

// 10-26 用户定一轮版：整条视频每 0.2 秒一帧拼成大图，只问豆包一次（实测比两轮快约 40%、便宜一半，准确度一样）。
// 每帧按面积定大小（约 320×320 像素，竖屏 720×1280 正好 240 宽），每行 10 帧 = 2 秒；
// 每张最多 80 帧，在豆包最高清晰度 xhigh 的约 900 万像素上限内，超了就均分成几张，不留只有一帧的尾巴图。
const FRAME_AREA = 320 * 320, PER_SECOND = 5, COLUMNS = 10, MAX_FRAMES = 80;
const frameCount = seconds => Math.max(1, Math.ceil(seconds * PER_SECOND - 1e-9));
const rounded = n => Math.round(n * 1e6) / 1e6;
/** 非方形像素的片子先按显示比例拉成方形像素，截出来的图才不变形。 */
export const SQUARE_PIXELS = 'scale=trunc(iw*sar/2)*2:ih,setsar=1';

export function createSheets({ executor = createExecutor(), platform = process.platform, env = process.env, exists = existsSync } = {}) {
  function timestamp(offset) {
    const font = platform === 'win32' ? join(env.WINDIR ?? 'C:/Windows', 'Fonts', 'arial.ttf')
      : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
    if (!exists(font)) throw Error('找不到印时间所需的字体文件，请安装 Arial（Windows）或 DejaVuSans 后再试。');
    const escaped = font.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    return `drawtext=fontfile='${escaped}':text='%{pts\\:flt\\:${offset}}s':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:x=6:y=6`;
  }
  async function image(source, folder, name, start, filter, seconds) {
    mkdirSync(folder, { recursive: true });
    await executor.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(start), '-i', source,
      '-t', String(seconds), '-an', '-vf', filter, '-frames:v', '1', '-pix_fmt', 'yuvj420p', '-q:v', '2', join(folder, name)]);
    return name;
  }
  async function timeline({ source, folder, duration, width, height }) {
    const frameWidth = 2 * Math.round(Math.sqrt(FRAME_AREA * width / height) / 2);
    const total = frameCount(duration), sheets = Math.ceil(total / MAX_FRAMES), perSheet = Math.ceil(total / sheets);
    const names = [];
    for (let index = 0; index < sheets; index++) {
      const start = rounded(index * perSheet / PER_SECOND), seconds = rounded(Math.min(perSheet / PER_SECOND, duration - start));
      const frames = frameCount(seconds);
      names.push(await image(source, folder, `timeline-${index}.jpg`, start,
        `${SQUARE_PIXELS},fps=${PER_SECOND}:start_time=0:eof_action=pass,scale=${frameWidth}:-2,${timestamp(start)},tile=${COLUMNS}x${Math.ceil(frames / COLUMNS)}:nb_frames=${frames}:padding=3:margin=3`,
        seconds));
    }
    return names;
  }
  /** 10-30：拼图每帧太小认不出东西（猫认成柯基），同一次问里再附几张原片清楚大帧；长边最多 1920（xhigh 下每张约 1280 token），小片不放大。 */
  async function frames({ source, folder }, times) {
    mkdirSync(folder, { recursive: true });
    const names = [];
    for (const [index, second] of times.entries()) {
      const name = `frame-${index}.jpg`;
      await executor.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(second), '-i', source, '-an',
        '-frames:v', '1', '-vf', `${SQUARE_PIXELS},scale=w='min(iw,1920)':h='min(ih,1920)':force_original_aspect_ratio=decrease`, '-pix_fmt', 'yuvj420p', '-q:v', '3', join(folder, name)]);
      names.push(name);
    }
    return names;
  }
  async function cuts(source, duration) {
    const { stderr = '' } = await executor.run('ffmpeg', ['-hide_banner', '-i', source, '-vf',
      'select=gt(scene\\,0.30),showinfo', '-an', '-f', 'null', '-']);
    return [...new Set([...stderr.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1])))]
      .filter(n => n > 0 && n < duration).sort((a, b) => a - b);
  }
  return { timeline, frames, cuts, stop: () => executor.stop() };
}
