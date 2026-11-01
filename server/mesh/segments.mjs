/** 10-31 用户定：白模长视频分段算再拼。整条进 ComfyUI 时所有帧压在显存里，372 帧挤爆 16GB、借内存后慢几倍；
 * 每段不超过 160 帧（实测 132~140 帧一段约 2 分钟），相邻两段多算 16 帧，各取中间、丢掉两头，接缝处不跳。 */
export const MESH_SEGMENT_FRAMES = 160;
export const MESH_SEGMENT_OVERLAP = 16;

/** 各段按 keepFrom/keepTo 取中间帧首尾相接，拼成一条无声视频。 */
export function spliceArgs(pieces, segments, fps, output) {
  const trims = segments.map((segment, index) =>
    `[${index}:v]fps=${fps},trim=start_frame=${segment.keepFrom}:end_frame=${segment.keepTo},setpts=PTS-STARTPTS[p${index}]`);
  return ['-v', 'error', '-n', ...pieces.flatMap(piece => ['-i', piece]), '-filter_complex',
    `${trims.join(';')};${segments.map((_, index) => `[p${index}]`).join('')}concat=n=${segments.length}:v=1:a=0[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', output];
}

/** start/end 是这段在整条里的帧范围；keepFrom/keepTo 是拼接时从这段里取的帧（段内编号）。 */
export function meshSegments(frames) {
  if (frames <= MESH_SEGMENT_FRAMES) return [{ start: 0, end: frames, keepFrom: 0, keepTo: frames }];
  const half = MESH_SEGMENT_OVERLAP / 2, count = Math.ceil(frames / (MESH_SEGMENT_FRAMES - MESH_SEGMENT_OVERLAP - 1));
  const cuts = Array.from({ length: count + 1 }, (_, index) => Math.round(index * frames / count));
  return cuts.slice(0, -1).map((cut, index) => {
    const start = Math.max(0, cut - half), end = Math.min(frames, cuts[index + 1] + half);
    return { start, end, keepFrom: cut - start, keepTo: cuts[index + 1] - start };
  });
}
