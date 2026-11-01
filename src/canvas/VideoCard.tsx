import { memo, useEffect, useRef, useState, type Ref } from "react";
import { NodeToolbar, Position, useStore, type NodeProps } from "@xyflow/react";
import { CardHandle, LineEnd } from "./CardHandle";
import { CardTools } from "./CardTools";
import { BusyOverlay } from "./BusyOverlay";
import { PromptPanel } from "./PromptPanel";
import { RewriteProgress } from "./RewriteProgress";
import { RewriteInput } from "./RewriteInput";
import { VideoClipBar } from './VideoClipBar';
import { useBoard } from "./boardContext";
import { isOnlySelectedCard } from "@/domain/boardControls";
import { handleVisibility } from "@/domain/selection";
import { assetUrl, cardTitle, currentResult, imageFailure } from "@/domain/cards";
import { api } from "@/api";
import { durationLabel, phaseLabel, videoAspect } from "@/domain/videoPanel";
import { useDeletedWorks } from "@/library/worksEvents";
import type { AssetRef, CardNode } from "@/types";

type FrameProps = {
  url: string; title: string; seconds?: number; playing: boolean; videoRef?: Ref<HTMLVideoElement>;
  failure: "missing" | "retry" | null; missingText: string; error?: string | null;
  onStart: () => void; onError: () => void; onPlay: () => void; onStop: () => void;
};

/**
 * 预览本体允许选参考和拖卡；原生播放控制期间才隔离画布手势。
 * 双击交给画布放大对准；Chrome 播放器靠「第二下 click」进全屏（拦 dblclick 没用，10-22 实测），所以拦第二下。
 */
export function VideoFrame({ url, title, seconds, playing, videoRef, failure, missingText, error, onStart, onError, onPlay, onStop }: FrameProps) {
  if (failure === "missing") return <div className="card__empty">{missingText}</div>;
  return <>
    <video ref={videoRef} className={`card__video${playing ? " nodrag nowheel nopan" : ""}`} src={`${url}#t=0.001`} preload="metadata" playsInline
      aria-label={title} controls={playing} onPlay={onPlay} onPause={onStop} onEnded={onStop} onError={onError}
      onClick={event => { if (event.detail >= 2) event.preventDefault(); }} />
    {!playing && !failure ? <button type="button" className="card__play nodrag nowheel nopan" aria-label="播放视频" onClick={onStart}>▶</button> : null}
    {!playing ? <span className="card__duration">{durationLabel(seconds)}</span> : null}
    {failure || error ? <div className="card__note nodrag nowheel nopan">{failure ? "视频没加载出来，正在重试…" : error}</div> : null}
  </>;
}

/** 按结果地址挂载，翻页时销毁播放器；404 显示删除且不出上方工具条，其它加载故障自动重试。点「预览」先停掉卡里的播放。 */
function CardVideo({ asset, url, title, seconds, missingText, cardId }: { asset: AssetRef; url: string; title: string; seconds?: number; missingText: string; cardId?: string }) {
  const board = useBoard();
  const activeClip = board.videoClip?.session;
  const clip = activeClip && activeClip.cardId === cardId ? activeClip : null;
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [failure, setFailure] = useState<"missing" | "retry" | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!failed) return;
    let alive = true;
    let timer: number | undefined;
    const controller = new AbortController();
    void api.probeImage(url, controller.signal).then(status => {
      if (!alive) return;
      const next = imageFailure(status);
      setFailure(next);
      if (next === "retry") timer = window.setTimeout(() => {
        setAttempt(value => value + 1); setFailed(false); setFailure(null); setError(null);
      }, 3000);
    });
    return () => { alive = false; controller.abort(); window.clearTimeout(timer); };
  }, [failed, url]);
  return <>
    <VideoFrame key={attempt} videoRef={video} url={attempt ? `${url}&retry=${attempt}` : url} title={title} seconds={seconds}
      playing={playing} failure={failure} missingText={missingText} error={error}
      onError={() => { setFailed(true); setPlaying(false); }} onPlay={() => { setPlaying(true); setError(null); }}
      onStop={() => setPlaying(false)}
      onStart={() => {
        setPlaying(true);
        void video.current?.play().catch(() => { setPlaying(false); setError("视频没播起来，请再点播放按钮试一次。"); });
      }} />
    {failure !== "missing" && !clip ? <CardTools asset={asset} title={title} media="video" cardId={cardId} onOpen={() => video.current?.pause()} /> : null}
    {clip ? <NodeToolbar position={Position.Bottom} offset={8} isVisible><VideoClipBar session={clip} video={video} playerVersion={attempt} /></NodeToolbar> : null}
  </>;
}

function VideoCardView({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard();
  const selectedCount = useStore(state => state.nodes.filter(node => node.selected).length);
  const connecting = useStore(state => state.connection.inProgress);
  const fromType = useStore(state => state.connection.fromHandle?.type);
  const deletedWorks = useDeletedWorks();
  if (data.kind !== "video") return null;
  const onlySelected = isOnlySelectedCard(selected, selectedCount);
  const clipSession = board.videoClip?.session;
  const clipping = clipSession?.cardId === id;
  const title = cardTitle(data);
  const current = clipping ? clipSession.asset : currentResult(data);
  const url = current ? assetUrl(current) : null;
  const missing = Boolean(current?.type === "work" && deletedWorks.has(current.id));
  const isGenerate = data.source === "generate";
  const handles = handleVisibility(selected, connecting, isGenerate, fromType);
  const localBusy = Boolean(data.depthJobId || (data.source === "depth" || data.source === 'mesh') && data.startedAt && !data.note && !current);
  const busy = data.jobs.length > 0 || localBusy;
  const rewriteBusy = isGenerate && Boolean(data.rewriteBusy);
  const total = data.results.length;
  const page = total ? Math.min(Math.max(0, data.page), total - 1) : 0;
  return <div className={`card card--video${selected ? " is-selected" : ""}`}>
    <div className="card__title">{title}</div>
    <div className="card__body" style={{ aspectRatio: videoAspect(data.video, current) }}>
      {current && url && !missing ? <CardVideo key={url} asset={current} url={url} title={title} seconds={current.seconds} cardId={data.source === "depth" || data.source === 'mesh' ? undefined : id}
        missingText={current?.type === "work" ? "作品已删除" : "这段视频找不到了"} /> :
        <div className="card__empty">{missing ? "作品已删除" : isGenerate ? "写提示词生成视频，或连图片 / 视频当参考" : "没有视频"}</div>}
      {rewriteBusy ? <RewriteProgress data={data} overlay /> : localBusy ? <BusyOverlay text="正在生成中…" local onStop={data.depthJobId ? () => void board.stopLocal([id]) : undefined} /> : busy ? <BusyOverlay text={data.jobWarning ?? `${phaseLabel(data.phase)}${data.jobs.length > 1 ? `（${data.jobs.length} 单）` : ""}`} /> : null}
      {!busy && data.note ? <div className="card__note nodrag nowheel nopan">{data.note}</div> : null}
      {total > 1 ? <div className="card__pager nodrag nowheel nopan">
        <button type="button" aria-label="上一段" disabled={clipping || page === 0} onClick={() => board.turnPage(id, -1)}>◀</button>
        <span>{page + 1}/{total}</span>
        <button type="button" aria-label="下一段" disabled={clipping || page === total - 1} onClick={() => board.turnPage(id, 1)}>▶</button>
      </div> : null}
    </div>
    {!rewriteBusy ? <RewriteProgress data={data} /> : null}
    {isGenerate ? <CardHandle type="target" visible={handles.target} showPlus={onlySelected} onClick={anchor => board.openRefMenu(id, anchor)} />
      : data.source === "depth" || data.source === 'mesh' || data.mediaSource ? <LineEnd /> : null}
    <CardHandle type="source" visible={handles.source} showPlus={onlySelected} onClick={anchor => board.openNextMenu(id, anchor)} />
    {clipping ? null : onlySelected && board.videoRewrite?.inputId === id ? <NodeToolbar position={Position.Bottom} offset={14}><RewriteInput key={`${id}:${current?.type}:${current?.id}`} id={id} /></NodeToolbar> :
      // 面板不随缩放、比卡宽，居中会盖住左边那列；改写卡从卡左边往右展开（用户 10-30）。
      isGenerate ? <NodeToolbar position={Position.Bottom} offset={14} align={data.rewriteId ? "start" : "center"}><PromptPanel id={id} data={data} /></NodeToolbar> : null}
  </div>;
}

export const VideoCard = memo(VideoCardView);
