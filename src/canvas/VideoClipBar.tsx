import type { RefObject } from 'react';
import { useBoard } from './boardContext';
import { VideoClipTimeline, type ClipTimelineProps } from './VideoClipTimeline';
import { useClipControls } from './useClipControls';
import { useClipThumbnails } from './useClipThumbnails';
import { assetUrl } from '@/domain/cards';
import type { ClipSession } from './useVideoClip';
import '@/styles/videoClip.css';

const shortcuts = [
  [['移动选区', ['←', '→']], ['扩展/收缩选区', ['↑', '↓']], ['设置出点入点', ['I', 'O']], ['退出', ['Esc']]],
  [['精确模式', ['按住', 'Shift']], ['快速调整', ['⌘/Ctrl', '+', '↑', '↓']], ['播放/暂停', ['Space']], ['确认剪辑', ['Enter']]]
] as const;

export function ClipShortcutHelp({ onClose }: { onClose: () => void }) {
  return <div className="clip-help" role="dialog" aria-label="快捷键">
    <header><strong>快捷键</strong><button type="button" aria-label="关闭快捷键" onClick={onClose}>×</button></header>
    <div className="clip-help__columns">{shortcuts.map((column, i) => <div key={i}>{column.map(([label, keys]) =>
      <div className="clip-help__row" key={label}><span>{label}</span><span>{keys.map((key, j) => key === '按住' || key === '+'
        ? <span key={j}>{key} </span> : <kbd key={j}>{key}</kbd>)}</span></div>)}</div>)}</div>
  </div>;
}

type ViewProps = ClipTimelineProps & { loop: boolean; help: boolean; onClose: () => void; onHelp: () => void;
  onSnap: () => void; onLoop: () => void; onConfirm: () => void };

export function VideoClipBarView(props: ViewProps) {
  const { busy, snap, loop } = props;
  const snapLabel = snap ? '关闭整数秒吸附' : '开启整数秒吸附';
  const loopLabel = loop ? '关闭选区循环播放' : '开启选区循环播放';
  return <div className="video-clip nodrag nopan nowheel" role="region" aria-label="片段截取"
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {props.help ? <ClipShortcutHelp onClose={props.onHelp} /> : null}
    <div className="video-clip__bar">
      <button type="button" className="video-clip__round" aria-label="退出" title="退出" disabled={busy} onClick={props.onClose}>×</button>
      <span role="separator" className="video-clip__separator" />
      <button type="button" className="video-clip__round" aria-label="快捷键" title="快捷键" aria-expanded={props.help} onClick={props.onHelp}>⌨</button>
      <VideoClipTimeline {...props} />
      <div className="video-clip__switches">
        <button type="button" className="video-clip__round" aria-label={snapLabel} title={snapLabel} aria-pressed={snap} disabled={busy} onClick={props.onSnap}>⌁</button>
        <button type="button" className="video-clip__round" aria-label={loopLabel} title={loopLabel} aria-pressed={loop} disabled={busy} onClick={props.onLoop}>↻</button>
      </div>
      <button type="button" className="video-clip__confirm" aria-label="确认剪辑" title="确认剪辑" disabled={busy} onClick={props.onConfirm}>
        {busy ? <span className="busy-spinner" /> : '✓'}
      </button>
    </div>
    {busy ? <div className="video-clip__status" role="status">截取中…</div> : null}
  </div>;
}

export function VideoClipBar({ session, video, playerVersion = 0 }: { session: ClipSession; video: RefObject<HTMLVideoElement | null>; playerVersion?: number }) {
  const board = useBoard(), clip = board.videoClip!;
  const controls = useClipControls({ duration: session.duration, video, playerVersion, busy: clip.busy, onClose: clip.close,
    onConfirm: range => void clip.confirm(range), notify: board.notify });
  const { thumbnails, failed } = useClipThumbnails(assetUrl(session.asset), session.duration);
  return <div data-thumbnails-failed={failed || undefined}><VideoClipBarView {...controls} duration={session.duration}
    thumbnails={thumbnails} busy={clip.busy} onClose={clip.close} onConfirm={() => void clip.confirm(controls.range)} /></div>;
}
