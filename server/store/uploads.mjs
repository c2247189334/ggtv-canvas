// 上传的图片或视频：存 <数据>/上传/<编号>.<后缀>，画布只记编号，不进作品库。
// 类型看文件头几个字节，不信浏览器报的 Content-Type。没有画布在用的，启动时由 cleanup.mjs 真删掉。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, openSync, readSync, closeSync, statSync, renameSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { isId, newId } from './files.mjs';
import { parseMp4, readMp4File } from '../mp4.mjs';
import { readBodyToFile } from '../http.mjs';

const TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime' };

export function imageTypeOf(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 8 && buffer.readUInt32BE(0) === 0x89504e47) return { ext: 'png', type: TYPES.png };
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', type: TYPES.jpg };
  if (buffer.length >= 12 && buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: TYPES.webp };
  }
  return null;
}

export function createUploadStore(dataRoot) {
  const dir = join(dataRoot, '上传');

  function path(id) {
    if (!isId(id)) return null;
    for (const ext of Object.keys(TYPES)) {
      const file = join(dir, `${id}.${ext}`);
      if (existsSync(file)) return file;
    }
    return null;
  }

  /** 保存可识别的图片或含视频轨、时长的 MP4 / MOV；认不出返回 null。 */
  function save(buffer) {
    const image = imageTypeOf(buffer);
    const kind = image ? { kind: 'image', ext: image.ext, contentType: image.type } : parseMp4(buffer);
    if (!kind) return null;
    mkdirSync(dir, { recursive: true });
    const id = newId();
    writeFileSync(join(dir, `${id}.${kind.ext}`), buffer);
    const { ext, contentType, ...meta } = kind;
    return { id, ...meta };
  }

  async function saveStream(req, { limit, message, validate = () => {} }) {
    mkdirSync(dir, { recursive: true });
    const id = newId();
    const part = join(dir, `${id}.part`);
    try {
      await readBodyToFile(req, part, limit, message);
      const meta = fileMetadata(part);
      if (!meta) return null;
      validate(meta);
      const { ext, contentType, bytes, ...saved } = meta;
      renameSync(part, join(dir, `${id}.${ext}`));
      return { id, ...saved };
    } finally { rmSync(part, { force: true }); }
  }

  /** 本机产物按文件复制到part后改名；只读头和moov，不把整段视频装进内存。 */
  function saveFile(file) {
    const meta = fileMetadata(file);
    if (!meta) return null;
    mkdirSync(dir, { recursive: true });
    const id = newId(), part = join(dir, `${id}.part`);
    try {
      copyFileSync(file, part);
      const { ext, contentType, bytes, ...saved } = meta;
      renameSync(part, join(dir, `${id}.${ext}`));
      return { id, ...saved };
    } finally { rmSync(part, { force: true }); }
  }

  /** 读出媒体字节和从文件识别的类型、视频元数据。找不到返回 null。 */
  function read(id) {
    const file = path(id);
    if (!file) return null;
    const buffer = readFileSync(file);
    const meta = mediaMetadata(buffer);
    return meta ? { buffer, ...meta } : null;
  }

  function metadata(id) {
    const file = path(id);
    const value = file && fileMetadata(file);
    if (!value) return null;
    const { ext, ...meta } = value;
    return meta;
  }

  function pruneParts() {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.part') && isId(name.slice(0, -5))) rmSync(join(dir, name), { force: true });
    }
  }

  /** 硬盘上所有上传素材的编号。 */
  function ids() {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((name) => /^(.+)\.(png|jpg|webp|mp4|mov)$/.exec(name)?.[1])
      .filter(isId);
  }

  /** 真删文件，不留备份。不存在返回 false。 */
  function remove(id) {
    const file = path(id);
    if (!file) return false;
    rmSync(file, { force: true });
    return true;
  }

  return { save, saveStream, saveFile, path, read, metadata, ids, remove, pruneParts };
}

/** 图片只看头，MP4/MOV只读盒子头和moov；不把整个媒体文件读进内存。 */
export function fileMetadata(file) {
  const bytes = statSync(file).size;
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(12);
  let count;
  try { count = readSync(fd, head, 0, head.length, 0); }
  finally { closeSync(fd); }
  const image = imageTypeOf(head.subarray(0, count));
  if (image) return { kind: 'image', ext: image.ext, contentType: image.type, bytes };
  const video = readMp4File(file);
  return video ? { ...video, bytes } : null;
}

function mediaMetadata(buffer) {
  const image = imageTypeOf(buffer);
  if (image) return { kind: 'image', contentType: image.type };
  const video = parseMp4(buffer);
  if (!video) return null;
  const { ext, ...meta } = video;
  return meta;
}
