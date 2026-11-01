import { useEffect, useRef, useState, type RefObject } from 'react';
import { clipKeyRange, clipPlaybackTime, defaultClipRange, type ClipRange } from '@/domain/videoClip';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import type { Notify } from '@/common/Toast';

type Props = { duration: number; video: RefObject<HTMLVideoElement | null>; busy: boolean; playerVersion?: number;
  onClose: () => void; onConfirm: (range: ClipRange) => void; notify: Notify };

/** 捕获阶段消费剪辑期间的按键，Esc仍交统一弹层；播放始终使用卡里原video。 */
export function useClipControls({ duration, video, busy, playerVersion = 0, onClose, onConfirm, notify }: Props) {
  const [range, setRange] = useState(() => defaultClipRange(duration));
  const [snap, setSnap] = useState(false), [loop, setLoop] = useState(true);
  const [precise, setPrecise] = useState(false), [time, setTime] = useState(0), [help, setHelp] = useState(false);
  const latest = useRef({ range, loop, busy, onClose, onConfirm, notify });
  latest.current = { range, loop, busy, onClose, onConfirm, notify };
  const seek = (second: number) => { if (video.current) { video.current.currentTime = second; setTime(second); } };
  const update = (next: ClipRange, jump: boolean) => {
    latest.current.range = next; setRange(next);
    if (jump) seek(next.start);
  };
  useEscapeLayer(() => { if (!latest.current.busy) latest.current.onClose(); }, true, 1050);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.pause(); element.currentTime = latest.current.range.start;
    let animation = 0;
    const play = () => { void element.play().catch(() => latest.current.notify('视频没播起来，请再点播放按钮试一次。')); };
    const sample = () => {
      const state = latest.current;
      const next = clipPlaybackTime(element.currentTime, state.range, state.loop && (!element.paused || element.ended));
      if (next !== element.currentTime) {
        const ended = element.ended;
        element.currentTime = next;
        if (ended) play();
      }
      setTime(element.currentTime);
    };
    const tick = () => { sample(); if (!element.paused) animation = window.requestAnimationFrame(tick); };
    const onPlay = () => { window.cancelAnimationFrame(animation); tick(); };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      if (event.key !== 'Tab') event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Shift') setPrecise(true);
      const state = latest.current;
      if (state.busy || event.key === 'Shift') return;
      if (event.key === ' ' || event.code === 'Space') {
        if (element.paused) {
          if (element.currentTime < state.range.start || element.currentTime >= state.range.end) seek(state.range.start);
          play();
        } else element.pause();
      } else if (event.key === 'Enter') state.onConfirm(state.range);
      else {
        const next = clipKeyRange(state.range, event.key, duration, element.currentTime, event.ctrlKey || event.metaKey);
        if (next !== state.range) update(next, event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key.toLowerCase() === 'i');
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Escape') return;
      event.stopImmediatePropagation();
      if (event.key === 'Shift') setPrecise(false);
    };
    const blur = () => setPrecise(false);
    for (const name of ['timeupdate', 'seeking', 'seeked', 'ended', 'pause']) element.addEventListener(name, sample);
    element.addEventListener('play', onPlay);
    window.addEventListener('keydown', onKey, true); window.addEventListener('keyup', onKeyUp, true); window.addEventListener('blur', blur);
    return () => {
      window.cancelAnimationFrame(animation); element.pause();
      for (const name of ['timeupdate', 'seeking', 'seeked', 'ended', 'pause']) element.removeEventListener(name, sample);
      element.removeEventListener('play', onPlay);
      window.removeEventListener('keydown', onKey, true); window.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', blur);
    };
  }, [duration, video, playerVersion]);
  return { range, snap, loop, precise, time, help, onRange: update, onSeek: seek,
    onSnap: () => setSnap(value => !value), onLoop: () => setLoop(value => !value), onHelp: () => setHelp(value => !value) };
}
