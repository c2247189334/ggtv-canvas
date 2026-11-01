import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { configured } from '../config.mjs';
import { isId } from '../store/files.mjs';
import { parseMp4 } from '../mp4.mjs';
import { createExecutor } from './executor.mjs';
import { createVideoClip } from './videoClip.mjs';
import { createMeshMedia } from '../mesh/local.mjs';
import { SQUARE_PIXELS } from '../videoRewrite/sheets.mjs';

export const SMALL_SHA256 = '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609';
const script = fileURLToPath(new URL('./depth_video.py', import.meta.url));

/** 等比缩放后向上对齐偶数；480方图补足像素，H.264 yuv420p需要偶数。 */
export function depthGeometry({ width, height, fps }, resolution) {
  if (!['480p', '720p'].includes(resolution)) throw Error('清晰度只能选 480p 或 720p。');
  if (!(width > 0 && height > 0) || width / height < 0.4 || width / height > 2.5) throw Error('原视频宽高比要在 0.4 到 2.5 之间。');
  if (!(fps > 0 && Number.isFinite(fps))) throw Error('原视频读不出帧率。');
  const factor = Math.max(Number.parseInt(resolution) / Math.min(width, height), Math.sqrt(407696 / (width * height)));
  return { width: Math.ceil(width * factor / 2) * 2, height: Math.ceil(height * factor / 2) * 2,
    fps: Math.min(60, Math.max(24, fps)) };
}

async function verifyDepthModel(env) {
  const python = configured(env, 'DEPTH_PYTHON'), model = configured(env, 'DEPTH_MODEL_DIR');
  if (!existsSync(python)) throw Error('DEPTH_PYTHON 找不到 python.exe，请检查配置。');
  const checkpoint = join(model, 'checkpoints', 'video_depth_anything_vits.pth');
  if (!existsSync(join(model, 'video_depth_anything')) || !existsSync(checkpoint)) throw Error('DEPTH_MODEL_DIR 找不到源码或官方 Small 权重。');
  const extra = configured(env, 'DEPTH_EXTRA_PACKAGES');
  if (extra && !existsSync(extra)) throw Error('DEPTH_EXTRA_PACKAGES 找不到额外包目录。');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(checkpoint)) hash.update(chunk);
  if (hash.digest('hex') !== SMALL_SHA256) throw Error('模型权重 SHA256 不对，只允许官方 Small 权重。');
}

/** 视频改写的背景帧：秒数要在时长内；太靠末尾按帧率往前挪一帧，免得截空。 */
export function frameStart({ duration, fps }, second) {
  if (typeof second !== 'number' || !Number.isFinite(second) || second < 0 || second >= duration) throw Error('截帧秒数要在视频时长内。');
  return Math.max(0, Math.min(second, duration - (fps > 0 ? 1.01 / fps : 1)));
}

/** 卡上只留人话：自己抛的中文句、Python 的中文 ValueError 保留；退出码、堆栈、英文原文由 temporary 记进小服务日志。 */
export function localError(error) {
  const raw = String(error?.message ?? error);
  let reason = '本地处理失败，没有自动重跑，花费 0。';
  if (/out of memory|OutOfMemory/i.test(raw)) reason = '显存不够，关掉其他占显存的软件后可以再点一次，花费 0。';
  else if (/NO_CUDA|no CUDA|CUDA.*available|没.*CUDA/i.test(raw)) reason = '没找到可用的 CUDA 显卡，不会改用 CPU，花费 0。';
  else if (/ENOENT/.test(raw)) reason = '找不到执行程序，请检查 DEPTH_PYTHON 和 PATH 里的 ffmpeg / ffprobe。';
  else if (/ModuleNotFoundError|No module named/.test(raw)) reason = '深度的 Python 环境缺少依赖包，请检查 DEPTH_PYTHON 和 DEPTH_EXTRA_PACKAGES。';
  const last = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).at(-1) ?? '';
  // 执行器报错（「xx 退出码 n」+ 原文）只认 Python 主动抛的中文 XxxError；自己抛的中文句原样保留。
  const text = /退出码/.test(raw) ? last.match(/^[A-Za-z]*Error: (.*)$/)?.[1] ?? '' : last;
  const human = /[一-鿿]/.test(text) && !/退出码|Traceback|[A-Za-z]:\\|\/[\w.-]+\//.test(text);
  return human ? `${reason}\n${text}` : reason === '本地处理失败，没有自动重跑，花费 0。' ? `${reason}\n详情见小服务日志。` : reason;
}

export function createLocalMedia({ dataRoot, uploads, works, readEnv = () => ({}), fake = false,
  executor = createExecutor(), verifyModel = verifyDepthModel, logError }) {
  function checkSource(source, { maxSeconds = Infinity } = {}) {
    if (!source || !['upload', 'work'].includes(source.type) || !isId(source.id)) throw Error('视频来源的编号不对。');
    const store = source.type === 'upload' ? uploads : works;
    const meta = store.metadata(source.id);
    if (!meta) throw Error(source.type === 'work' ? '作品已删除。' : '上传的视频找不到了。');
    if (meta.kind !== 'video') throw Error('请选择一个视频来源。');
    if (meta.duration > maxSeconds) throw Error('原片超过 30 秒，火山参考视频最长 30 秒，请先截短。');
    return { ...meta, path: store.path(source.id) };
  }
  async function temporary(action) {
    const root = join(dataRoot, 'processing'); mkdirSync(root, { recursive: true });
    const folder = mkdtempSync(join(root, 'media-'));
    try { return await action(folder); }
    catch (error) {
      if (!error.canceled) logError?.('本机处理失败', error);
      throw Object.assign(Error(localError(error)), error.canceled ? { canceled: true } : {});
    }
    finally { rmSync(folder, { recursive: true, force: true }); }
  }
  async function depth(job, { signal } = {}) {
    const meta = checkSource(job.source, { maxSeconds: 30 });
    const size = depthGeometry(meta, job.resolution);
    const env = readEnv();
    if (!fake) {
      for (const name of ['DEPTH_PYTHON', 'DEPTH_MODEL_DIR']) if (!configured(env, name)) throw Error(`.env.local 里还没填 ${name}，花费 0。`);
      await verifyModel(env);
    }
    return temporary(async folder => {
      const output = join(folder, 'depth.mp4'), started = Date.now();
      if (fake) await executor.run('ffmpeg', ['-v', 'error', '-n', '-i', meta.path, '-an', '-vf',
        `format=gray,scale=${size.width}:${size.height},fps=${size.fps},setsar=1`, '-t', String(meta.videoDuration ?? meta.duration),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output], { signal });
      else await executor.run(configured(env, 'DEPTH_PYTHON'), ['-B', script, '--input', meta.path, '--resolution', job.resolution,
        '--model-dir', configured(env, 'DEPTH_MODEL_DIR'), ...(configured(env, 'DEPTH_EXTRA_PACKAGES') ?
          ['--extra-packages', configured(env, 'DEPTH_EXTRA_PACKAGES')] : []), '--output', output], { signal });
      const buffer = readFileSync(output), video = parseMp4(buffer);
      if (!video || video.width !== size.width || video.height !== size.height) throw Error('输出视频的尺寸不对，没有存进作品库。');
      if (video.fps === null || Math.abs(video.fps - size.fps) > 0.001 || Math.abs(video.duration - (meta.videoDuration ?? meta.duration)) > 1 / size.fps + 0.001) {
        throw Error('输出视频的帧率或时长不对，没有存进作品库。');
      }
      const work = works.addVideo(buffer, { ...job, jobId: job.id, depth: true,
        model: 'Video-Depth-Anything-Small', yuan: 0, elapsedSeconds: (Date.now() - started) / 1000,
        prompt: `深度视频；来源 ${job.source.type}:${job.source.id}；${job.resolution}；花费 0` });
      if (!work) throw Error('输出不是有效的视频。');
      return work;
    });
  }
  async function extract(job) {
    const meta = checkSource(job.source);
    if (!meta.hasAudio) throw Error('这段视频没有声音');
    return temporary(async folder => {
      const output = join(folder, 'audio.wav');
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-i', meta.path, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', output]);
      const work = works.addAudio(readFileSync(output), { ...job,
        prompt: `原声；来源 ${job.source.type}:${job.source.id}；格式 wav` });
      if (!work) throw Error('提取结果不是有效的 16 位 PCM WAV。');
      return work;
    });
  }
  async function frame(job) {
    const meta = checkSource(job.source), start = frameStart(meta, job.second);
    return temporary(async folder => {
      const output = join(folder, 'frame.jpg');
      await executor.run('ffmpeg', ['-v', 'error', '-n', '-ss', String(start), '-i', meta.path, '-an', '-vf', SQUARE_PIXELS,
        '-frames:v', '1', '-q:v', '2', output]);
      const saved = uploads.save(readFileSync(output));
      if (saved?.kind !== 'image') throw Error('截出来的不是有效图片。');
      return saved;
    });
  }
  const clip = createVideoClip({ checkSource, temporary, executor, uploads });
  const meshMedia = createMeshMedia({ dataRoot, uploads, works, readEnv, fake, executor,
    geometry: depthGeometry, logError, checkSource });
  return { depth, mesh: meshMedia.mesh, extract, frame, clip, checkSource, stop: () => { meshMedia.stop(); executor.stop(); } };
}
