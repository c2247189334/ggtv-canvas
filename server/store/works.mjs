// 作品库：一个作品一个文件夹 <数据>/作品/<编号>/，里面 image.jpg / image.png 或 video.mp4 + work.json
// （提示词、模型、花费、时间、来自哪张画布、用了哪些参考）。只放生成结果；上传素材不进来。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId, readJsonSafe, writeJsonAtomic } from './files.mjs';
import { imageSize } from '../imageSize.mjs';
import { parseMp4 } from '../mp4.mjs';
import { imageTypeOf, fileMetadata } from './uploads.mjs';
import { parseWav } from '../wav.mjs';

export function createWorkStore(dataRoot, { now = () => new Date() } = {}) {
  const dir = join(dataRoot, '作品');
  const imageFile = (id, ext = 'png') => join(dir, id, `image.${ext}`);
  const videoFile = (id) => join(dir, id, 'video.mp4');
  const audioFile = (id) => join(dir, id, 'audio.wav');
  const metaFile = (id) => join(dir, id, 'work.json');

  /** 存一张出好的图。meta：{ jobId, canvasId, prompt, model, yuan, refs }。 */
  function add(image, meta) {
    const id = newId();
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(imageFile(id, imageTypeOf(image)?.ext === 'jpg' ? 'jpg' : 'png'), image);
    const size = imageSize(image);
    const work = {
      id,
      kind: 'image',
      createdAt: now().toISOString(),
      canvasId: meta?.canvasId ?? null,
      jobId: meta?.jobId ?? null,
      prompt: meta?.prompt ?? '',
      model: meta?.model ?? '',
      yuan: meta?.yuan ?? 0,
      refs: meta?.refs ?? [],
      width: size?.width ?? null,
      height: size?.height ?? null
    };
    writeJsonAtomic(metaFile(id), work);
    return work;
  }

  function addVideo(buffer, meta) {
    const video = parseMp4(buffer);
    if (!video) return null;
    const id = newId();
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(videoFile(id), buffer);
    const work = {
      id, kind: 'video', createdAt: now().toISOString(),
      canvasId: meta?.canvasId ?? null, jobId: meta?.jobId ?? null,
      prompt: meta?.prompt ?? '', model: meta?.model ?? '', yuan: meta?.yuan ?? 0,
      refs: meta?.refs ?? [], duration: video.duration, width: video.width, height: video.height, hasAudio: video.hasAudio, fps: video.fps,
      ...(meta?.depth ? { depth: true, source: meta.source, elapsedSeconds: meta.elapsedSeconds } : {}),
      ...(meta?.mesh ? { mesh: true, source: meta.source, elapsedSeconds: meta.elapsedSeconds } : {}),
      resolution: meta?.resolution ?? null, ratio: meta?.ratio ?? null,
      mode: meta?.mode ?? null, taskId: meta?.taskId ?? null
    };
    writeJsonAtomic(metaFile(id), work);
    return work;
  }

  function addAudio(buffer, meta = {}) {
    const audio = parseWav(buffer);
    if (!audio) return null;
    const id = newId();
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(audioFile(id), buffer);
    const work = { id, ...audio, createdAt: now().toISOString(), canvasId: meta.canvasId ?? null,
      jobId: meta.jobId ?? null, source: meta.source ?? null, format: 'wav', yuan: 0,
      prompt: meta.prompt ?? '', model: 'audio-extract', refs: meta.refs ?? [] };
    writeJsonAtomic(metaFile(id), work);
    return work;
  }

  /** 新的在前。读坏的、图没了的跳过。 */
  function list() {
    if (!existsSync(dir)) return [];
    const works = [];
    for (const id of readdirSync(dir)) {
      if (!isId(id)) continue;
      const work = readJsonSafe(metaFile(id));
      if (work && path(id)) works.push(work);
    }
    return works.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function path(id) {
    if (!isId(id)) return null;
    const work = readJsonSafe(metaFile(id));
    const file = work?.kind === 'audio' ? audioFile(id) : work?.kind === 'video' ? videoFile(id)
      : existsSync(imageFile(id, 'jpg')) ? imageFile(id, 'jpg') : imageFile(id);
    return existsSync(file) ? file : null;
  }

  function read(id) {
    const file = path(id);
    if (!file) return null;
    const buffer = readFileSync(file);
    const image = imageTypeOf(buffer);
    if (image) return { buffer, kind: 'image', contentType: image.type };
    const audio = parseWav(buffer);
    if (audio) return { buffer, ...audio };
    const video = parseMp4(buffer);
    if (!video) return null;
    const { ext, ...meta } = video;
    return { buffer, ...meta };
  }

  function metadata(id) {
    const file = path(id);
    if (!file) return null;
    const media = fileMetadata(file);
    if (media) {
      const { ext, ...meta } = media;
      return meta;
    }
    const value = read(id);
    if (!value) return null;
    const { buffer, ...meta } = value;
    return meta;
  }

  function remove(id) {
    if (!isId(id) || !existsSync(join(dir, id))) return false;
    rmSync(join(dir, id), { recursive: true, force: true });
    return true;
  }

  return { add, addVideo, addAudio, list, path, read, metadata, remove };
}
