import { useRef, type PointerEvent } from 'react';
import { clipTicks, moveClipHandle, translateClipRange, type ClipRange } from '@/domain/videoClip';

export type ClipTimelineProps = { duration: number; range: ClipRange; time: number; thumbnails: string[]; precise: boolean;
  snap: boolean; busy: boolean; onRange: (range: ClipRange, seek: boolean) => void; onSeek: (time: number) => void };

export function VideoClipTimeline({ duration, range, time, thumbnails, precise, snap, busy, onRange, onSeek }: ClipTimelineProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number; range: ClipRange; side: 'start' | 'end' | 'move' } | null>(null);
  const percent = (second: number) => `${Math.min(100, Math.max(0, second / duration * 100))}%`;
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (busy || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const second = Math.max(0, Math.min(duration, (event.clientX - rect.left) / rect.width * duration));
    const target = event.target as Element;
    const side = target.closest('[data-clip-handle]')?.getAttribute('data-clip-handle');
    if (!side && (second < range.start || second > range.end)) { onSeek(second); return; }
    drag.current = { pointerId: event.pointerId, x: event.clientX, width: rect.width, range: { ...range },
      side: side === 'start' || side === 'end' ? side : 'move' };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const origin = drag.current;
    if (!origin || busy || origin.pointerId !== event.pointerId) return;
    const delta = (event.clientX - origin.x) / origin.width * duration;
    const next = origin.side === 'move' ? translateClipRange(origin.range, delta, duration)
      : moveClipHandle(origin.range, origin.side, origin.range[origin.side] + delta, duration, snap);
    onRange(next, origin.side !== 'end');
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    move(event); drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="clip-timeline" role="group" aria-label="时间条" data-start={range.start} data-end={range.end}
    onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }}>
    <div className="clip-timeline__thumbnails">{thumbnails.map((url, i) => <img key={i} src={url} alt={`视频缩略图 ${i + 1}`} draggable={false} />)}</div>
    <div className="clip-timeline__shade" style={{ left: 0, width: percent(range.start) }} />
    <div className="clip-timeline__shade" style={{ left: percent(range.end), right: 0 }} />
    {clipTicks(duration, precise).map(second => <span key={second} className="clip-timeline__tick" style={{ left: percent(second) }} />)}
    <div className="clip-timeline__selection" aria-label="选区" style={{ left: percent(range.start), width: percent(range.end - range.start) }}>
      <span className="clip-timeline__handle clip-timeline__handle--start" aria-label="左把手" data-clip-handle="start"><i /></span>
      <span className={`clip-timeline__duration${(range.end - range.start) / duration * 350 < 60 ? ' is-small' : ''}`}>{(range.end - range.start).toFixed(2)} s</span>
      <span className="clip-timeline__handle clip-timeline__handle--end" aria-label="右把手" data-clip-handle="end"><i /></span>
    </div>
    <span className="clip-timeline__head" style={{ left: percent(time) }} />
  </div>;
}
