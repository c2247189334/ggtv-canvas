// 只认完整的 RIFF/WAVE PCM 文件；时长来自 data 大小和真实采样格式。
export function parseWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  const end = buffer.readUInt32LE(4) + 8;
  if (end > buffer.length || end < 12) return null;
  let format, dataSize = 0;
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) return null;
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > end) return null;
    if (type === 'fmt ') {
      if (size < 16 || buffer.readUInt16LE(start) !== 1) return null;
      format = { channels: buffer.readUInt16LE(start + 2), sampleRate: buffer.readUInt32LE(start + 4),
        byteRate: buffer.readUInt32LE(start + 8), blockAlign: buffer.readUInt16LE(start + 12), bitsPerSample: buffer.readUInt16LE(start + 14) };
    }
    if (type === 'data') dataSize += size;
    offset = start + size + (size % 2);
  }
  if (!format || !dataSize) return null;
  const { channels, sampleRate, byteRate, blockAlign, bitsPerSample } = format;
  if (!channels || !sampleRate || bitsPerSample !== 16 || blockAlign !== channels * 2 ||
    byteRate !== sampleRate * blockAlign || dataSize % blockAlign) return null;
  return { kind: 'audio', contentType: 'audio/wav', duration: dataSize / byteRate,
    channels, sampleRate, bitsPerSample, bytes: buffer.length };
}
