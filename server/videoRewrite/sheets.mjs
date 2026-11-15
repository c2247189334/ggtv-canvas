import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createExecutor } from '../depth/executor.mjs';

// 10-26 用户定一轮版：整条视频每 0.2 秒一帧拼成大图，只问一次（10-26 豆包实测比两轮快约 40%、便宜一半，准确度一样）。
// 每帧按面积定大小（约 320×320 像素，竖屏 720×1280 正好 240 宽），每行 10 帧 = 2 秒；
// 每张最多 80 帧，在约 900 万像素以内（当时按豆包最高清晰度 xhigh 定的），超了就均分成几张，不留只有一帧的尾巴图。
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
  async function frames({ source, folder }, times, { maxSide = 1920 } = {}) {
    mkdirSync(folder, { recursive: true });
    const names = [];
    for (const [index, second] of times.entries()) {
      const name = `frame-${index}.jpg`;
      await executor.run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(second), '-i', source, '-an',
        '-frames:v', '1', '-vf', `${SQUARE_PIXELS},scale=w='min(iw,${maxSide})':h='min(ih,${maxSide})':force_original_aspect_ratio=decrease`, '-pix_fmt', 'yuvj420p', '-q:v', '3', join(folder, name)]);
      names.push(name);
    }
    return names;
  }
  /**
   * 11-11 多类型测：定稿只看每 1.7 秒一帧，功夫舞高踢、高尔夫抛杆都写错了。这里从 start 到 end 每 step 秒一帧、印秒数拼成连拍，
   * 每张最多 columns×rows 帧；帧按面积定大小（不用先知道宽高，竖屏约 270×480）。回 [{ name, from, to }]。
   */
  async function contact({ source, folder }, { start = 0, end, step = 0.5, columns = 6, rows = 2, area = 270 * 480, prefix = 'contact' }) {
    const total = Math.max(1, Math.ceil(rounded((end - start) / step) - 1e-9)), perSheet = columns * rows, result = [];
    for (let index = 0; index * perSheet < total; index++) {
      const from = rounded(start + index * perSheet * step), count = Math.min(perSheet, total - index * perSheet);
      const name = await image(source, folder, `${prefix}-${index}.jpg`, from,
        `${SQUARE_PIXELS},fps=${rounded(1 / step)}:start_time=0:eof_action=pass,scale=w='trunc(sqrt(${area}*iw/ih)/2)*2':h=-2,${timestamp(from)},tile=${columns}x${Math.ceil(count / columns)}:nb_frames=${count}:padding=3:margin=3`,
        rounded(count * step));
      result.push({ name, from, to: rounded(from + (count - 1) * step) });
    }
    return result;
  }
  async function cuts(source, duration) {
    const { stderr = '' } = await executor.run('ffmpeg', ['-hide_banner', '-i', source, '-vf',
      'select=gt(scene\\,0.30),showinfo', '-an', '-f', 'null', '-']);
    return [...new Set([...stderr.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1])))]
      .filter(n => n > 0 && n < duration).sort((a, b) => a - b);
  }
  /** 11-09：这一秒那帧最亮的像素（0~255，视频里纯黑约 16），背景帧兜底判黑屏用；读不出数字回 null。 */
  async function peak({ source }, second) {
    const { stderr = '' } = await executor.run('ffmpeg', ['-hide_banner', '-ss', String(second), '-i', source, '-an',
      '-frames:v', '1', '-vf', 'signalstats,metadata=print', '-f', 'null', '-']);
    const match = String(stderr).match(/lavfi\.signalstats\.YMAX=([\d.]+)/);
    return match ? Number(match[1]) : null;
  }
  return { timeline, frames, contact, cuts, peak, stop: () => executor.stop() };
}
