import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode, VideoClipUpload } from '@/types';
import { newCanvasCard } from './cards';
import { rightOf } from './placement';
import { linkId } from './refs';

export type ClipRange = { start: number; end: number };
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const precise = (value: number) => Math.round(value * 1e8) / 1e8;

export function defaultClipRange(duration: number): ClipRange {
  return { start: 0, end: Math.max(duration / 3, 1) };
}

export function snapClipTime(time: number, enabled: boolean): number {
  const second = Math.round(time);
  return enabled && Math.abs(time - second) <= 0.10000001 ? second : time;
}

export function moveClipHandle(range: ClipRange, side: 'start' | 'end', time: number, duration: number, snap = false): ClipRange {
  const value = snapClipTime(time, snap);
  return side === 'start' ? { ...range, start: precise(clamp(value, 0, range.end - 1)) }
    : { ...range, end: precise(clamp(value, range.start + 1, duration)) };
}

export function translateClipRange(range: ClipRange, delta: number, duration: number): ClipRange {
  const shift = clamp(delta, -range.start, duration - range.end);
  return { start: precise(range.start + shift), end: precise(range.end + shift) };
}

export function clipKeyRange(range: ClipRange, key: string, duration: number, currentTime: number, fast = false): ClipRange {
  const step = fast ? 1 : 0.1;
  if (key === 'ArrowLeft' || key === 'ArrowRight') return translateClipRange(range, key === 'ArrowLeft' ? -step : step, duration);
  if (key === 'ArrowUp' || key === 'ArrowDown') return moveClipHandle(range, 'end', range.end + (key === 'ArrowUp' ? -step : step), duration);
  if (key.toLowerCase() === 'i') return moveClipHandle(range, 'start', currentTime, duration);
  if (key.toLowerCase() === 'o') return moveClipHandle(range, 'end', currentTime, duration);
  return range;
}

export function clipTicks(duration: number, preciseMode: boolean): number[] {
  return preciseMode ? Array.from({ length: Math.max(0, Math.ceil(duration * 2) - 1) }, (_, i) => (i + 1) / 2) : [];
}

export function clipPlaybackTime(time: number, range: ClipRange, loop: boolean): number {
  return loop && time >= range.end ? range.start : time;
}

/** 截出的媒体按上传卡保存；来源线和新卡由调用方在同一批更新中加入。 */
export function clipChild(source: CardNode, asset: AssetRef, upload: VideoClipUpload, id: string): { node: CardNode; edge: Edge } {
  const result: AssetRef = { type: 'upload', id: upload.id, media: 'video', seconds: upload.duration,
    width: upload.width, height: upload.height, fps: upload.fps, hasAudio: upload.hasAudio };
  const data = newCanvasCard('upload', () => 0, [result], 'video', '剪辑');
  data.mediaSource = { ...asset };
  return { node: { id, type: 'card', position: rightOf(source.position), selected: true, data },
    edge: { id: linkId(source.id, id), source: source.id, target: id } };
}
