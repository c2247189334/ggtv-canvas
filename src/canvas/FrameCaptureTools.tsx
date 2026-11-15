import { useState } from 'react';
import { useBoard } from './boardContext';
import { FloatingPanel } from './FloatingPanel';
import type { FrameKind, Playhead } from '@/domain/videoFrame';

const ICON = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6,
  strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
/** 自己画的相机图标和小箭头。 */
const CameraIcon = () => <svg {...ICON}><path d="M2.5 5.5h2.5l1.2-2h3.6l1.2 2h2.5v7h-11z" /><circle cx="8" cy="9" r="2.2" /></svg>;
const ChevronIcon = () => <svg {...ICON} width={10} height={10}><path d="M4 6l4 4 4-4" /></svg>;

const ITEMS: Array<[FrameKind, string]> = [['current', '截取当前帧'], ['first', '截取首帧'], ['last', '截取尾帧']];

export function FrameCaptureItems({ onPick }: { onPick: (kind: FrameKind) => void }) {
  return <div className="card-tools__menu-list" role="menu">
    {ITEMS.map(([kind, label]) => <button key={kind} type="button" role="menuitem" className="card-tools__menu-item"
      onClick={() => onPick(kind)}>{label}</button>)}
  </div>;
}

/** 视频卡工具条下载左边的「视频截图 ▾」（11-09 用户定照参考软件）：点开三项，截好的图放视频右边。 */
export function FrameCaptureTools({ cardId, playhead }: { cardId: string; playhead: () => Playhead }) {
  const board = useBoard();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const pick = (kind: FrameKind) => { setMenu(null); void board.captureFrame?.(cardId, kind, playhead()); };
  return <>
    <button type="button" className="card-tools__button card-tools__icon card-tools__frame" aria-label="视频截图" title="视频截图"
      aria-haspopup="menu" aria-expanded={Boolean(menu)} onClick={event => setMenu(menu ? null : event.currentTarget)}>
      <CameraIcon /><ChevronIcon />
    </button>
    {menu ? <FloatingPanel anchor={menu} keepAnchor className="card-tools__menu" onClose={() => setMenu(null)}>
      <FrameCaptureItems onPick={pick} />
    </FloatingPanel> : null}
  </>;
}
