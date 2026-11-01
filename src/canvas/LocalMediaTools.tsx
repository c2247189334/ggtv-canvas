import { useState } from "react";
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

export function LocalMediaTools({ cardId, asset }: { cardId: string; asset: AssetRef }) {
  const board = useBoard();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [action, setAction] = useState<'depth' | 'mesh'>('depth');
  const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  const [busy, setBusy] = useState(false);
  const run = async (action: "depth" | "mesh" | "audio") => {
    if (busy) return;
    setBusy(true);
    try { await board.localMedia?.(cardId, action, resolution); }
    finally { setBusy(false); setAnchor(null); }
  };
  return <>
    <button type="button" className="card-tools__button" disabled={busy} onClick={event => {
      setAction('depth'); setResolution("480p"); setAnchor(event.currentTarget);
    }}>深度动作捕捉</button>
    <button type="button" className="card-tools__button" disabled={busy} onClick={event => {
      setAction('mesh'); setAnchor(event.currentTarget);
    }}>白模动作捕捉</button>
    <button type="button" className="card-tools__button" disabled={busy || asset.hasAudio === false}
      title={asset.hasAudio === false ? "这段视频没有声音" : "提取视频原声"} onClick={() => void run("audio")}>提取原声</button>
    {anchor ? <FloatingPanel anchor={anchor} onClose={() => setAnchor(null)}>
      {action === 'mesh' ? <MeshChoices busy={busy} onConfirm={() => void run('mesh')} /> :
        <DepthChoices resolution={resolution} onChange={setResolution} busy={busy} onConfirm={() => void run('depth')} />}
    </FloatingPanel> : null}
  </>;
}
