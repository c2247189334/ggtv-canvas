// 单元测试用完整PCM WAV，不依赖ffmpeg或显卡。
export function wav(seconds = 2, channels = 2, sampleRate = 48000) {
  const bytes = seconds * channels * sampleRate * 2;
  const b = Buffer.alloc(44 + bytes);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(channels * sampleRate * 2, 28);
  b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(bytes, 40);
  return b;
}
