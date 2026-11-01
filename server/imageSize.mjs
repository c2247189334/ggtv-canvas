// 作品图片尺寸：PNG 沿用 IHDR；JPEG 跳过元数据段，读 SOF，不启动外部程序。
import { pngSize } from './png.mjs';

const sof = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

export function imageSize(buffer) {
  const png = pngSize(buffer);
  if (png) return png;
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset++] !== 0xff) return null;
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset++];
    if (marker === 0xda || marker === 0xd9 || marker === 0x00) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if (sof.has(marker)) {
      if (length < 8 || length !== 8 + 3 * buffer[offset + 7]) return null;
      const height = buffer.readUInt16BE(offset + 3), width = buffer.readUInt16BE(offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}
