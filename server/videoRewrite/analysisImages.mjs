import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 两种拆解共用总览与清楚大帧，最多12张，一次交给模型。 */
export async function analysisImages(input, sheets) {
  const timeline = await sheets.timeline(input), cuts = await sheets.cuts(input.source, input.duration);
  const count = Math.max(0, Math.min(6, 12 - timeline.length));
  const times = Array.from({ length: count }, (_, i) => Math.round((i + 0.5) * input.duration / count * 10) / 10);
  const frames = count ? await sheets.frames(input, times) : [];
  const images = [...timeline, ...frames].map(name => `data:image/jpeg;base64,${readFileSync(join(input.folder, name)).toString('base64')}`);
  return { timeline, cuts, times, frames, images };
}
