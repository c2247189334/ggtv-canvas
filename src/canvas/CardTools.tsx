import { NodeToolbar, Position } from "@xyflow/react";
import { useBoard } from "./boardContext";
import { assetDownloadUrl, assetUrl } from "@/domain/cards";
import type { AssetRef } from "@/types";
import { LocalMediaTools } from "./LocalMediaTools";
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { toolbarPosition } from '@/domain/toolbarPosition';

type Props = { asset: AssetRef; title: string; media: "image" | "video" | "audio"; onOpen?: () => void; cardId?: string };

/** 只在库显示工具条时挂载；跟随库定位层的位移，按钮保持屏幕像素大小。 */
function ViewportTools({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const tools = ref.current, layer = tools?.closest<HTMLElement>('.react-flow__node-toolbar');
    if (!tools || !layer) return;
    const update = () => {
      const node = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
        .find(element => element.dataset.id === layer.dataset.id);
      if (!node) return;
      const position = toolbarPosition(node.getBoundingClientRect(),
        { width: tools.offsetWidth, height: tools.offsetHeight }, { width: innerWidth, height: innerHeight });
      const original = layer.getBoundingClientRect();
      tools.style.transform = `translate(${position.left - original.left}px, ${position.top - original.top}px)`;
    };
    update();
    const movement = new MutationObserver(update);
    movement.observe(layer, { attributes: true, attributeFilter: ['style'] });
    const size = new ResizeObserver(update); size.observe(tools);
    window.addEventListener('resize', update);
    return () => { movement.disconnect(); size.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  return <div className="card-tools" ref={ref}>{children}</div>;
}

/**
 * 只选中一张有内容的卡时，卡上方的工具条。
 * 视频还提供本机深度和原声操作；看大图走预览，双击卡片是放大对准。
 */
export function CardTools({ asset, title, media, onOpen, cardId }: Props) {
  const board = useBoard();
  return (
    <NodeToolbar position={Position.Top} offset={10}>
      <ViewportTools>
        <a className="card-tools__button" href={assetDownloadUrl(asset)} download>下载</a>
        <button type="button" className="card-tools__button" onClick={() => { onOpen?.(); board.openViewer(assetUrl(asset), title, media); }}>预览</button>
        {media === "video" && cardId && !asset.depth && !asset.mesh ? <LocalMediaTools cardId={cardId} asset={asset} /> : null}
        {media === "video" && cardId && !asset.depth && !asset.mesh ? <button type="button" className="card-tools__button"
          aria-label="片段截取" disabled={typeof asset.seconds === 'number' && asset.seconds < 1}
          title={typeof asset.seconds === 'number' && asset.seconds < 1 ? '视频不到 1 秒，不能截取' : '片段截取'}
          onClick={() => void board.videoClip?.start(cardId)}>片段截取</button> : null}
        {media === "video" && cardId && !asset.depth && !asset.mesh ? <button type="button" className="card-tools__button"
          onClick={() => board.videoRewrite?.start(cardId)}>视频改写</button> : null}
      </ViewportTools>
    </NodeToolbar>
  );
}
