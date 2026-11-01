// 只读 ISO BMFF 的盒子和视频轨元数据，不解码、不依赖 ffmpeg。
import { openSync, closeSync, fstatSync, readSync } from 'node:fs';

/** 从文件跳过媒体数据；验证所有顶层盒子边界，只载入ftyp品牌和moov。 */
export function readMp4File(file, { read = readSync } = {}) {
  const fd = openSync(file, 'r');
  try {
    const length = fstatSync(fd).size;
    const chunk = (offset, size) => {
      const data = Buffer.alloc(size);
      let done = 0;
      while (done < size) {
        const count = read(fd, data, done, size - done, offset + done);
        if (!count) return null;
        done += count;
      }
      return data;
    };
    let ftyp = null, moov = null;
    for (let offset = 0; offset < length;) {
      if (length - offset < 8) return null;
      const head = chunk(offset, 8);
      if (!head) return null;
      let size = head.readUInt32BE(0), header = 8;
      const type = head.toString('latin1', 4, 8);
      if (offset === 0 && type !== 'ftyp') return null;
      if (size === 1) {
        if (length - offset < 16) return null;
        const large = chunk(offset + 8, 8);
        if (!large || large.readBigUInt64BE() > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(large.readBigUInt64BE()); header = 16;
      } else if (size === 0) size = length - offset;
      if (size < header || size > length - offset) return null;
      if (offset === 0) {
        if (size - header < 8) return null;
        const brand = chunk(offset + header, 8);
        if (!brand) return null;
        ftyp = Buffer.concat([Buffer.from([0, 0, 0, 16, 102, 116, 121, 112]), brand]);
      } else if (type === 'moov' && !moov) {
        moov = chunk(offset, size);
        if (!moov) return null;
      }
      offset += size;
    }
    return ftyp && moov ? parseMp4(Buffer.concat([ftyp, moov])) : null;
  } finally { closeSync(fd); }
}

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let offset = start; offset < end;) {
    if (offset + 8 > end) return null;
    let size = buffer.readUInt32BE(offset);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > end) return null;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(large);
      header = 16;
    } else if (size === 0) size = end - offset;
    if (size < header || offset + size > end) return null;
    result.push({ type: buffer.toString('latin1', offset + 4, offset + 8), start: offset + header, end: offset + size });
    offset += size;
  }
  return result;
}

function children(buffer, parent) {
  return boxes(buffer, parent.start, parent.end);
}

/** 视频轨播放时长（tkhd，已算剪辑表，单位是整片的 timescale）；声音比画面长时整个文件时长按声音算，本机出片要按画面比。 */
function trackDuration(buffer, tkhd, timescale) {
  const v1 = buffer[tkhd.start] === 1, at = tkhd.start + (v1 ? 28 : 20);
  if (at + (v1 ? 8 : 4) > tkhd.end) return null;
  const ticks = v1 ? Number(buffer.readBigUInt64BE(at)) : buffer.readUInt32BE(at);
  return ticks > 0 && ticks < 2 ** 53 ? ticks / timescale : null;
}

function frameRate(buffer, media) {
  const mdhd = media.find(b => b.type === 'mdhd');
  const minf = media.find(b => b.type === 'minf');
  const stbl = minf && children(buffer, minf)?.find(b => b.type === 'stbl');
  const stts = stbl && children(buffer, stbl)?.find(b => b.type === 'stts');
  if (!mdhd || !stts || stts.start + 8 > stts.end) return null;
  const time = mdhd.start + (buffer[mdhd.start] === 1 ? 20 : 12);
  if (time + 4 > mdhd.end) return null;
  const scale = buffer.readUInt32BE(time);
  const entries = buffer.readUInt32BE(stts.start + 4);
  if (stts.start + 8 + entries * 8 > stts.end) return null;
  let frames = 0, ticks = 0;
  for (let p = stts.start + 8; p < stts.start + 8 + entries * 8; p += 8) {
    const count = buffer.readUInt32BE(p);
    frames += count; ticks += count * buffer.readUInt32BE(p + 4);
  }
  return scale && ticks ? frames * scale / ticks : null;
}

/** 认不出类型、时长或视频轨时返回 null；任何截断数据都不会抛出。 */
export function parseMp4(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || buffer.toString('latin1', 4, 8) !== 'ftyp') return null;
  const top = boxes(buffer);
  if (!top || top[0]?.type !== 'ftyp' || top[0].end - top[0].start < 8) return null;
  const moov = top.find((item) => item.type === 'moov');
  if (!moov) return null;
  const movie = children(buffer, moov);
  if (!movie) return null;
  const mvhd = movie.find((item) => item.type === 'mvhd');
  if (!mvhd || mvhd.start >= mvhd.end) return null;
  const version = buffer[mvhd.start];
  if (version !== 0 && version !== 1) return null;
  const timeOffset = mvhd.start + (version ? 20 : 12);
  if (timeOffset + (version ? 12 : 8) > mvhd.end) return null;
  const timescale = buffer.readUInt32BE(timeOffset);
  const ticks = version ? Number(buffer.readBigUInt64BE(timeOffset + 4)) : buffer.readUInt32BE(timeOffset + 4);
  const duration = ticks / timescale;
  if (!timescale || !Number.isFinite(duration) || duration <= 0) return null;
  let video = null, hasAudio = false;
  for (const trak of movie.filter((item) => item.type === 'trak')) {
    const track = children(buffer, trak);
    if (!track) return null;
    const mdia = track.find((item) => item.type === 'mdia');
    const media = mdia && children(buffer, mdia);
    if (!media) continue;
    const hdlr = media.find((item) => item.type === 'hdlr');
    if (!hdlr || hdlr.start + 12 > hdlr.end) continue;
    const handler = buffer.toString('latin1', hdlr.start + 8, hdlr.start + 12);
    if (handler === 'soun') hasAudio = true;
    if (handler !== 'vide' || video) continue;
    const tkhd = track.find((item) => item.type === 'tkhd');
    if (!tkhd || tkhd.start >= tkhd.end || ![0, 1].includes(buffer[tkhd.start])) return null;
    const widthOffset = tkhd.start + (buffer[tkhd.start] ? 88 : 76);
    if (widthOffset + 8 > tkhd.end) return null;
    const stored = [buffer.readUInt32BE(widthOffset) / 65536, buffer.readUInt32BE(widthOffset + 4) / 65536];
    if (stored[0] <= 0 || stored[1] <= 0) return null;
    // 手机竖拍常只写旋转标记（tkhd 矩阵 a/b）；浏览器和 ffmpeg 都按转过后的方向显示，宽高跟着对调。
    const turned = Math.abs(buffer.readInt32BE(widthOffset - 32)) > Math.abs(buffer.readInt32BE(widthOffset - 36));
    const [width, height] = turned ? stored.reverse() : stored;
    const mov = buffer.toString('latin1', top[0].start, top[0].start + 4) === 'qt  ';
    video = { kind: 'video', contentType: mov ? 'video/quicktime' : 'video/mp4', ext: mov ? 'mov' : 'mp4', duration, width, height, fps: frameRate(buffer, media),
      videoDuration: trackDuration(buffer, tkhd, timescale) ?? duration };
  }
  return video ? { ...video, hasAudio } : null;
}
