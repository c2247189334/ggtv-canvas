import { memo, useEffect, useState } from "react";
import { NodeToolbar, Position, useStore, type NodeProps } from "@xyflow/react";
import { BusyOverlay } from "./BusyOverlay";
import { CardHandle, LineEnd } from "./CardHandle";
import { CardHead } from "./CardHead";
import { CardTools } from "./CardTools";
import { api } from "@/api";
import { useBoard } from "@/canvas/boardContext";
import { PromptPanel } from "@/canvas/PromptPanel";
import { isOnlySelectedCard } from "@/domain/boardControls";
import { handleVisibility } from "@/domain/selection";
import { assetUrl, cardTitle, currentResult, imageFailure } from "@/domain/cards";
import { useDeletedWorks } from "@/library/worksEvents";
import type { AssetRef, CardNode } from "@/types";
import { productEmptyText, productOriginalLook } from '@/domain/productRemake';
import { usesSceneText } from '@/domain/rewriteTextScene';

const IMAGE_RETRY_INTERVAL_MS = 3000;

/** key 用原图地址：翻页、换图时连同旧探测和重试计时器一起销毁。确定找不到（404）就不出上方工具条。 */
function CardImage({ asset, url, title, missingText, onSize, panelBelow }: { asset: AssetRef; url: string; title: string; missingText: string;
  onSize: (width: number, height: number) => void; panelBelow?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [failure, setFailure] = useState<"missing" | "retry" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!failed) return;
    let alive = true;
    let timer: number | undefined;
    const controller = new AbortController();
    void api.probeImage(url, controller.signal).then((status) => {
      if (!alive) return;
      const next = imageFailure(status);
      setFailure(next);
      if (next === "retry") {
        timer = window.setTimeout(() => {
          setAttempt((value) => value + 1);
          setFailed(false);
        }, IMAGE_RETRY_INTERVAL_MS);
      }
    });
    return () => {
      alive = false;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [failed, url]);

  return (
    <>
      {!failed && failure !== "missing" ? (
        <img
          key={attempt}
          className="card__image"
          src={attempt ? `${url}&retry=${attempt}` : url}
          alt={title}
          style={failure === "retry" ? { display: "none" } : undefined}
          draggable={false}
          onError={() => setFailed(true)}
          onLoad={event => { setFailure(null); onSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight); }}
        />
      ) : null}
      {failed || failure ? (
        <div className="card__empty">{failure === "missing" ? missingText : "图片没加载出来，正在重试…"}</div>
      ) : null}
      {failure !== "missing" ? <CardTools asset={asset} title={title} media="image" panelBelow={panelBelow} /> : null}
    </>
  );
}

/**
 * 画布上的图片卡（卡片就是结果）：上面一行小标题，下面一块显示图。
 * 生成中、失败都显示在卡里；多张结果 ◀ 2/4 ▶ 翻；唯一选中时上方工具条「下载 / 预览」（双击卡片是放大对准）。
 * 唯一选中时左右出 ＋：左 = 接参考图（只有生成卡有，传的图不收参考），右 = 用这张图生成新卡。
 */
function ImageCardView({ id, data, selected }: NodeProps<CardNode>) {
  const board = useBoard();
  const selectedCount = useStore((state) => state.nodes.filter((node) => node.selected).length);
  const onlySelected = isOnlySelectedCard(selected, selectedCount);
  const deletedWorks = useDeletedWorks();
  const title = cardTitle(data);
  const current = currentResult(data);
  const url = current ? assetUrl(current) : null;
  const missing = Boolean(current && deletedWorks.has(current.id));
  const isGenerate = data.source === "generate";
  const connecting = useStore(state => state.connection.inProgress);
  const fromType = useStore(state => state.connection.fromHandle?.type);
  const handles = handleVisibility(selected, connecting, isGenerate, fromType);
  const busy = data.jobs.length > 0;
  const total = data.results.length;
  const page = total ? Math.min(Math.max(0, data.page), total - 1) : 0;
  const productLook = useStore(state => data.kind === 'image' ? productOriginalLook(state.nodes as CardNode[], data.productRole) : '');
  // 有图时卡框跟着图的比例（11-08 用户定）；尺寸只在页面里量，不进存档。商品卡仍固定 3:4（一组里要对齐）。
  const [natural, setNatural] = useState<{ url: string; width: number; height: number } | null>(null);
  const size = natural && natural.url === url && !missing ? natural : null;
  const product = data.kind === "image" && data.productRole?.role === "product";
  // 11-11：改写卡还没图时按 emptyAspect 画框，和左边原片截图一样大、一行对齐。
  const frame = product ? null : size ? `${size.width} / ${size.height}` : data.kind === "image" && data.emptyAspect ? String(data.emptyAspect) : null;

  let empty = "没有图";
  if (missing) empty = current?.type === "work" ? "作品已删除" : "这张图找不到了";
  else if (isGenerate) empty = "写好提示词，点发送出图";
  if (data.kind === 'image' && data.rewriteItem) empty = `传：${data.rewriteItem.desc}`;
  if (data.kind === 'image' && data.productRole) empty = productEmptyText(data, productLook)!;
  // 11-13 背景卡「不出图，用文字」：卡面只显示写的字；原来有图也留着不删，改回用图时还在。
  const sceneText = usesSceneText(data);
  if (sceneText) empty = `用文字：${data.rewriteSceneText?.trim() || '（还没写）'}`;

  return (
    <div className={`card${selected ? " is-selected" : ""}${product ? " card--product" : ""}`}>
      <CardHead id={id} title={title} size={size}>{data.kind === "image" && data.assetId ? <span className="card__asset">真人素材</span> : null}</CardHead>
      <div className={`card__body${frame ? " card__body--fit" : ""}`} style={frame ? { aspectRatio: frame } : undefined}>
        {current && url && !missing && !sceneText ? (
          <CardImage key={url} asset={current} url={url} title={title} onSize={(width, height) => setNatural({ url, width, height })} panelBelow={isGenerate}
            missingText={current?.type === "work" ? "作品已删除" : "这张图找不到了"} />
        ) : (
          <div className={`card__empty${data.kind === 'image' && (data.rewriteItem || data.productRole || sceneText) ? ' card__replacement' : ''}`} title={empty}>{empty}</div>
        )}
        {busy ? <BusyOverlay text={`正在生成中…${data.jobs.length > 1 ? `（${data.jobs.length} 单）` : ""}`} /> : null}
        {!busy && data.note ? <div className="card__note">{data.note}</div> : null}
        {total > 1 ? (
          <div className="card__pager nodrag">
            <button type="button" aria-label="上一张" disabled={page === 0} onClick={() => board.turnPage(id, -1)}>◀</button>
            <span>{page + 1}/{total}</span>
            <button type="button" aria-label="下一张" disabled={page === total - 1} onClick={() => board.turnPage(id, 1)}>▶</button>
          </div>
        ) : null}
      </div>
      {isGenerate ? <CardHandle type="target" visible={handles.target} showPlus={onlySelected}
        onClick={anchor => board.openRefMenu(id, anchor)} /> : data.mediaSource ? <LineEnd /> : null}
      <CardHandle type="source" visible={handles.source} showPlus={onlySelected}
        onClick={anchor => board.openNextMenu(id, anchor)} />
      {isGenerate ? (
        <NodeToolbar position={Position.Bottom} offset={14}>
          <PromptPanel id={id} data={data} />
        </NodeToolbar>
      ) : null}
    </div>
  );
}

export const ImageCard = memo(ImageCardView);
