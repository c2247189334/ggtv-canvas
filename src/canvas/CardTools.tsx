import { NodeToolbar, Position } from "@xyflow/react";
import { useBoard } from "./boardContext";
import { assetDownloadUrl, assetUrl } from "@/domain/cards";
import type { AssetRef } from "@/types";
import { VideoMoreTools } from "./LocalMediaTools";
import { ViewportTools } from './ViewportTools';
import { ProductToolButtons } from './ProductTools';
import { FrameCaptureTools } from './FrameCaptureTools';
import type { Playhead } from '@/domain/videoFrame';

type Props = { asset: AssetRef; title: string; media: "image" | "video" | "audio"; onOpen?: () => void; cardId?: string; product?: boolean;
  /** 视频卡都给（深度、白模卡也给）：截图要用卡的编号和卡里播放器的时间。 */
  frame?: { cardId: string; playhead: () => Playhead };
  /** 卡下面挂着提示词 / 改写面板（11-09）：贴屏幕上边时工具条不往下放。 */
  panelBelow?: boolean };

/** 自己画的两个小图标（下载 / 预览做成右边小图标，图标自己画）。 */
const ICON = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.6,
  strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
const DownloadIcon = () => <svg {...ICON}><path d="M8 2.5v7.5M4.5 6.5 8 10l3.5-3.5M3 13.5h10" /></svg>;
const PreviewIcon = () => <svg {...ICON}><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>;

/**
 * 只选中一张有内容的卡时，卡上方的工具条（11-08 用户定）：
 * 原视频卡左边「视频改写 / 拆解（无人物）/ 更多 ▾」，不常用的深度、白模、原声、片段截取收进更多；
 * 最右边下载、预览两个小图标，视频卡下载左边多一个「视频截图 ▾」（11-09）。看大图走预览，双击卡片是放大对准。
 */
export function CardTools({ asset, title, media, onOpen, cardId, product, frame, panelBelow }: Props) {
  const board = useBoard();
  const source = media === "video" && cardId && !asset.depth && !asset.mesh ? cardId : null;
  return (
    <NodeToolbar position={Position.Top} offset={10}>
      <ViewportTools panelBelow={panelBelow}>
        {source ? <button type="button" className="card-tools__button"
          onClick={() => { board.productRemake?.close(); board.videoRewrite?.start(source); }}>视频改写</button> : null}
        {source ? <button type="button" className="card-tools__button"
          onClick={() => { board.videoRewrite?.close(); board.productRemake?.start(source); }}>拆解（无人物）</button> : null}
        {source ? <VideoMoreTools cardId={source} asset={asset} /> : null}
        {product && cardId ? <ProductToolButtons id={cardId} /> : null}
        {media === "image" && cardId && board.openLayers ? <button type="button" className="card-tools__button"
          onClick={() => board.openLayers?.(cardId)}>图层分离</button> : null}
        {source || (product && cardId) || (media === "image" && cardId && board.openLayers) ? <span className="card-tools__sep" aria-hidden="true" /> : null}
        {media === "video" && frame ? <FrameCaptureTools cardId={frame.cardId} playhead={frame.playhead} /> : null}
        <a className="card-tools__button card-tools__icon" href={assetDownloadUrl(asset)} download aria-label="下载" title="下载"><DownloadIcon /></a>
        <button type="button" className="card-tools__button card-tools__icon" aria-label="预览" title="预览"
          onClick={() => { onOpen?.(); board.openViewer(assetUrl(asset), title, media); }}><PreviewIcon /></button>
      </ViewportTools>
    </NodeToolbar>
  );
}
