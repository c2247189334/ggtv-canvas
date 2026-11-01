import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { configured } from '../config.mjs';
import { isId, newId } from '../store/files.mjs';
import { parseMp4 } from '../mp4.mjs';
import { createExecutor, stoppedError } from '../depth/executor.mjs';
import { createComfyClient } from './client.mjs';
import { createComfyProcess } from './process.mjs';
import { meshWorkflow } from './workflow.mjs';
import { cleanupComfyFiles } from './cleanup.mjs';
import { meshError } from './errors.mjs';
import { meshSegments, spliceArgs } from './segments.mjs';

/** 10-31 用户定：白模帧率最多 25。真 ComfyUI 50fps（330 帧）要 1221 秒，25fps（165 帧）220 秒；去辫子那条真出也是 25fps。 */
export const MESH_MAX_FPS = 25;
export const meshSize = size => ({ ...size, fps: Math.min(size.fps, MESH_MAX_FPS) });

/** geometry 由深度入口注入，共用尺寸规则而不形成循环导入。 */
export function createMeshMedia({ dataRoot, uploads, works, readEnv = () => ({}), fake = false,
  geometry, logError = console.error,
  checkSource, executor, comfyProcess = createComfyProcess(), clientFactory = createComfyClient,
  fetch, sleep, now = Date.now, timeoutMs } = {}) {
  const runner = executor ?? createExecutor();
  const sourceOf = checkSource ?? (source => {
    if (!source || !['upload', 'work'].includes(source.type) || !isId(source.id)) throw Error('视频来源的编号不对。');
    const store = source.type === 'upload' ? uploads : works, meta = store.metadata(source.id);
    if (!meta) throw Error(source.type === 'work' ? '作品已删除。' : '上传的视频找不到了。');
    if (meta.kind !== 'video') throw Error('请选择一个视频来源。');
    if (meta.duration > 30) throw Error('原片超过 30 秒，火山参考视频最长 30 秒，请先截短。');
    return { ...meta, path: store.path(source.id) };
  });
  const transcode = (input, output, meta, size, gray = false, signal) => runner.run('ffmpeg', [
    '-v', 'error', '-n', '-i', input, '-an', '-vf',
    `${gray ? 'format=gray,negate,' : ''}scale=${size.width}:${size.height},fps=${size.fps},setsar=1`,
    '-t', String(meta.videoDuration ?? meta.duration), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ], { signal });
  function validate(buffer, meta, size) {
    const video = parseMp4(buffer);
    if (!video || video.width !== size.width || video.height !== size.height) throw Error('输出视频的尺寸不对，没有存进作品库。');
    if (video.fps === null || Math.abs(video.fps - size.fps) > 0.001 || Math.abs(video.duration - (meta.videoDuration ?? meta.duration)) > 1 / size.fps + 0.001) {
      throw Error('输出视频的帧率或时长不对，没有存进作品库。');
    }
  }
  async function mesh(job, { signal } = {}) {
    let folder, client, portable = '', id = job.id ?? newId(), failure, work;
    const halt = () => { if (signal?.aborted) throw stoppedError(); };
    try {
      if (!isId(id)) throw Error('白模单的编号不对。');
      const meta = sourceOf(job.source, { maxSeconds: 30 }), size = meshSize(geometry(meta, '480p')), started = now();
      const env = readEnv(); portable = configured(env, 'COMFYUI_DIR');
      if (!fake) {
        client = clientFactory({ url: configured(env, 'COMFYUI_URL') || undefined, fetch, sleep, now, timeoutMs });
        await comfyProcess.ensure(client, portable); await client.check();
      }
      halt();
      const root = join(dataRoot, 'processing'); mkdirSync(root, { recursive: true });
      folder = mkdtempSync(join(root, 'mesh-'));
      const output = join(folder, 'mesh.mp4');
      if (fake) await transcode(meta.path, output, meta, size, true, signal);
      else {
        const prefix = `mesh-${id}`, prepared = join(folder, `${prefix}.mp4`);
        await transcode(meta.path, prepared, meta, size, false, signal);
        const preparedVideo = parseMp4(readFileSync(prepared));
        const segments = meshSegments(Math.round(preparedVideo.duration * preparedVideo.fps));
        const pieces = [];
        for (const [index, segment] of segments.entries()) {
          const name = segments.length > 1 ? `${prefix}-${index + 1}` : prefix, part = join(folder, `${name}.mp4`);
          if (segments.length > 1) await runner.run('ffmpeg', ['-v', 'error', '-n', '-i', prepared, '-vf',
            `trim=start_frame=${segment.start}:end_frame=${segment.end},setpts=PTS-STARTPTS`, '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', part], { signal });
          halt();
          const uploaded = await client.upload(readFileSync(part), `${name}.mp4`);
          const result = await client.wait(await client.submit(meshWorkflow(uploaded, `video/${name}`), id), { signal });
          const piece = join(folder, `comfy-${index + 1}.mp4`);
          writeFileSync(piece, await client.download(result)); pieces.push(piece);
          if (index < segments.length - 1) await client.free();
        }
        const downloaded = segments.length > 1 ? join(folder, 'comfy-video.mp4') : pieces[0];
        if (segments.length > 1) await runner.run('ffmpeg', spliceArgs(pieces, segments, size.fps, downloaded), { signal });
        await transcode(downloaded, output, meta, size, false, signal);
      }
      const buffer = readFileSync(output); validate(buffer, meta, size);
      work = works.addVideo(buffer, { ...job, jobId: id, resolution: '480p', mesh: true,
        model: 'SAM-3D-Body', yuan: 0, elapsedSeconds: (now() - started) / 1000,
        prompt: `白模视频；来源 ${job.source.type}:${job.source.id}；480p；花费 0` });
      if (!work) throw Error('输出不是有效的视频。');
    } catch (error) { if (!error.canceled) logError('白模处理失败', error); failure = error; }
    finally {
      if (client) {
        try { await client.free(); }
        catch (error) { logError('ComfyUI 释放显存失败', error); failure ??= Error('ComfyUI 释放显存失败'); }
      }
      if (!fake && portable && isId(id)) {
        try { cleanupComfyFiles(portable, id); }
        catch (error) { logError('ComfyUI 清理失败', error); failure ??= Error('ComfyUI 清理失败'); }
      }
      if (folder) {
        try { rmSync(folder, { recursive: true, force: true }); }
        catch (error) { logError('白模临时文件清理失败', error); failure ??= Error('白模临时文件清理失败'); }
      }
    }
    if (failure) throw Object.assign(Error(meshError(failure)), failure.gpuUnsafe ? { gpuUnsafe: true } : {}, failure.canceled ? { canceled: true } : {});
    return work;
  }
  return { mesh, stop: () => { comfyProcess.stop(); if (!executor) runner.stop(); } };
}
