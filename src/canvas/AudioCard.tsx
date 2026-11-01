import { memo, useEffect, useRef, useState } from "react";
import { useStore, type NodeProps } from "@xyflow/react";
import { api } from "@/api";
import { assetUrl, cardTitle, currentResult } from "@/domain/cards";
import { durationLabel } from "@/domain/videoPanel";
import { isOnlySelectedCard } from "@/domain/boardControls";
import { useDeletedWorks } from "@/library/worksEvents";
import { useBoard } from "./boardContext";
import { CardHandle, LineEnd } from "./CardHandle";
import { CardTools } from "./CardTools";
import type { CardNode } from "@/types";

function AudioCardView({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard();
  const count = useStore(state => state.nodes.filter(node => node.selected).length);
  const deleted = useDeletedWorks();
  const audio = useRef<HTMLAudioElement>(null);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const current = currentResult(data);
  const url = current ? assetUrl(current) : null;
  useEffect(() => {
    setFailed(false); setMissing(false); setAttempt(0);
  }, [url]);
  useEffect(() => {
    if (!failed || !url) return;
    let alive = true;
    let timer: number | undefined;
    const controller = new AbortController();
    void api.probeImage(url, controller.signal).then(status => {
      if (!alive) return;
      if (status === 404) setMissing(true);
      else timer = window.setTimeout(() => { setFailed(false); setAttempt(n => n + 1); }, 3000);
    });
    return () => { alive = false; controller.abort(); window.clearTimeout(timer); };
  }, [failed, url]);
  if (data.kind !== "audio") return null;
  const title = cardTitle(data);
  const gone = missing || Boolean(current?.type === "work" && deleted.has(current.id));
  const only = isOnlySelectedCard(selected, count);
  return <div className={`card card--audio${selected ? " is-selected" : ""}`}>
    <div className="card__title">{title}</div>
    <div className="card__body">
      {current && url && !gone ? <>
        <span className="card__audio-symbol">♪</span><span>{durationLabel(current.seconds)}</span>
        <audio ref={audio} key={`${url}-${attempt}`} className="card__audio nodrag nowheel nopan" controls src={attempt ? `${url}&retry=${attempt}` : url} preload="metadata"
          aria-label={title} onError={() => setFailed(true)} onPointerDown={event => event.stopPropagation()} onWheel={event => event.stopPropagation()} />
        {!failed ? <CardTools asset={current} title={title} media="audio" onOpen={() => audio.current?.pause()} /> : <span>声音没加载出来，正在重试…</span>}
      </> : <div className="card__empty">{gone ? "作品已删除" : data.note ?? "没有声音"}</div>}
      {current && data.note ? <div className="card__note">{data.note}</div> : null}
    </div>
    <LineEnd />
    <CardHandle type="source" visible={Boolean(selected)} showPlus={only} onClick={anchor => board.openNextMenu(id, anchor)} />
  </div>;
}
export const AudioCard = memo(AudioCardView);
