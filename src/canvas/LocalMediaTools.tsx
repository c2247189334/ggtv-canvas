import { useRef, useState } from "react";
import { useBoard } from "./boardContext";
import { FloatingPanel } from "./FloatingPanel";
import type { AssetRef } from "@/types";

/** 不写固定时长（用户 10-31 定：开源给所有人用，各人电脑快慢不同）。 */
const LOCAL_TIME_HINT = "本机计算，生成时间取决于电脑配置";

export function DepthChoices({ resolution, onChange, onConfirm, busy }: {
  resolution: "480p" | "720p"; onChange: (value: "480p" | "720p") => void; onConfirm: () => void; busy: boolean;
}) {
  return <div className="depth-choices"><strong>深度动作捕捉</strong>
    <div>{(["480p", "720p"] as const).map(value => <button key={value} type="button" aria-pressed={resolution === value}
      className={resolution === value ? "is-on" : ""} onClick={() => onChange(value)}>{value.toUpperCase()}</button>)}</div>
    <div>{LOCAL_TIME_HINT}</div>
    <button type="button" disabled={busy} onClick={onConfirm}>{busy ? "提交中…" : "确认提取"}</button>
  </div>;
}

export function MeshChoices({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  return <div className="depth-choices"><strong>白模动作捕捉</strong>
    <div>{LOCAL_TIME_HINT}</div>
    <button type="button" disabled={busy} onClick={onConfirm}>{busy ? '提交中…' : '确认提取'}</button>
  </div>;
}

type ItemProps = { asset: AssetRef; busy: boolean; onDepth: () => void; onMesh: () => void; onAudio: () => void; onClip: () => void };

/** 「更多 ▾」里的四项，顺序：深度、白模、提取原声、片段截取（11-08 用户定：不常用的收进更多）。 */
export function VideoMoreItems({ asset, busy, onDepth, onMesh, onAudio, onClip }: ItemProps) {
  const short = typeof asset.seconds === 'number' && asset.seconds < 1;
  return <div className="card-tools__menu-list" role="menu">
    <button type="button" role="menuitem" className="card-tools__menu-item" disabled={busy} onClick={onDepth}>深度动作捕捉</button>
    <button type="button" role="menuitem" className="card-tools__menu-item" disabled={busy} onClick={onMesh}>白模动作捕捉</button>
    <button type="button" role="menuitem" className="card-tools__menu-item" disabled={busy || asset.hasAudio === false}
      title={asset.hasAudio === false ? "这段视频没有声音" : "提取视频原声"} onClick={onAudio}>提取原声</button>
    <button type="button" role="menuitem" className="card-tools__menu-item" aria-label="片段截取" disabled={short}
      title={short ? '视频不到 1 秒，不能截取' : '片段截取'} onClick={onClip}>片段截取</button>
  </div>;
}

/** 视频卡上方的「更多 ▾」：点开列四项；深度 / 白模再弹确认浮层，浮层挂在「更多」按钮上（菜单关了也不丢位置）。 */
export function VideoMoreTools({ cardId, asset }: { cardId: string; asset: AssetRef }) {
  const board = useBoard();
  const button = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [action, setAction] = useState<'depth' | 'mesh' | null>(null);
  const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  const [busy, setBusy] = useState(false);
  const run = async (kind: "depth" | "mesh" | "audio") => {
    if (busy) return;
    setBusy(true); setMenu(null);
    try { await board.localMedia?.(cardId, kind, resolution); }
    finally { setBusy(false); setAction(null); }
  };
  const choose = (kind: 'depth' | 'mesh') => { setMenu(null); setResolution("480p"); setAction(kind); };
  return <>
    <button ref={button} type="button" className="card-tools__button" aria-haspopup="menu" aria-expanded={Boolean(menu)}
      onClick={event => { setAction(null); setMenu(menu ? null : event.currentTarget); }}>更多 ▾</button>
    {menu ? <FloatingPanel anchor={menu} keepAnchor className="card-tools__menu" onClose={() => setMenu(null)}>
      <VideoMoreItems asset={asset} busy={busy} onDepth={() => choose('depth')} onMesh={() => choose('mesh')}
        onAudio={() => void run("audio")} onClip={() => { setMenu(null); void board.videoClip?.start(cardId); }} />
    </FloatingPanel> : null}
    {action && button.current ? <FloatingPanel anchor={button.current} onClose={() => setAction(null)}>
      {action === 'mesh' ? <MeshChoices busy={busy} onConfirm={() => void run('mesh')} /> :
        <DepthChoices resolution={resolution} onChange={setResolution} busy={busy} onConfirm={() => void run('depth')} />}
    </FloatingPanel> : null}
  </>;
}
