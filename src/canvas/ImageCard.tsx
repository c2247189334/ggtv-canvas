import { memo, useEffect, useState } from "react";
import { NodeToolbar, Position, useStore, type NodeProps } from "@xyflow/react";
import { BusyOverlay } from "./BusyOverlay";
import { CardHandle } from "./CardHandle";
import { CardTools } from "./CardTools";
import { api } from "@/api";
import { useBoard } from "@/canvas/boardContext";
import { PromptPanel } from "@/canvas/PromptPanel";
import { isOnlySelectedCard } from "@/domain/boardControls";
import { handleVisibility } from "@/domain/selection";
import { assetUrl, cardTitle, currentResult, imageFailure } from "@/domain/cards";
import { useDeletedWorks } from "@/library/worksEvents";
import type { AssetRef, CardNode } from "@/types";

const IMAGE_RETRY_INTERVAL_MS = 3000;

/** key 用原图地址：翻页、换图时连同旧探测和重试计时器一起销毁。确定找不到（404）就不出上方工具条。 */
function CardImage({ asset, url, title, missingText }: { asset: AssetRef; url: string; title: string; missingText: string }) {
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
          onLoad={() => setFailure(null)}
        />
      ) : null}
      {failed || failure ? (
        <div className="card__empty">{failure === "missing" ? missingText : "图片没加载出来，正在重试…"}</div>
      ) : null}
      {failure !== "missing" ? <CardTools asset={asset} title={title} media="image" /> : null}
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
  const missing = Boolean(current?.type === "work" && deletedWorks.has(current.id));
  const isGenerate = data.source === "generate";
  const connecting = useStore(state => state.connection.inProgress);
  const fromType = useStore(state => state.connection.fromHandle?.type);
  const handles = handleVisibility(selected, connecting, isGenerate, fromType);
  const busy = data.jobs.length > 0;
  const total = data.results.length;
  const page = total ? Math.min(Math.max(0, data.page), total - 1) : 0;

  let empty = "没有图";
  if (missing) empty = "作品已删除";
  else if (isGenerate) empty = "写好提示词，点发送出图";
  if (data.kind === 'image' && data.rewriteItem) empty = `传：${data.rewriteItem.desc}`;

  return (
    <div className={selected ? "card is-selected" : "card"}>
      <div className="card__title">{title}{data.kind === "image" && data.assetId ? <span className="card__asset">真人素材</span> : null}</div>
      <div className="card__body">
        {current && url && !missing ? (
          <CardImage key={url} asset={current} url={url} title={title}
            missingText={current?.type === "work" ? "作品已删除" : "这张图找不到了"} />
        ) : (
          <div className={`card__empty${data.kind === 'image' && data.rewriteItem ? ' card__replacement' : ''}`} title={empty}>{empty}</div>
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
        onClick={anchor => board.openRefMenu(id, anchor)} /> : null}
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
