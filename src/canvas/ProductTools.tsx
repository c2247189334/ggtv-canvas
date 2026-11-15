import { NodeToolbar, Position, useNodes } from '@xyflow/react';
import { hasProductBackground } from '@/domain/productRemake';
import type { CardNode } from '@/types';
import { useBoard } from './boardContext';
import { ViewportTools } from './ViewportTools';

export function ProductToolButtons({ id }: { id: string }) {
  const nodes = useNodes<CardNode>();
  const action = useBoard().productRemake;
  const video = nodes.find(n => n.id === id)?.data;
  const ready = video?.kind === 'video' && Boolean(video.productPlan) && !video.rewriteBusy && !video.rewriteStatus;
  return <>
    <button type="button" className="card-tools__button" disabled={!ready} onClick={() => action?.addProduct(id)}>加商品</button>
    <button type="button" className="card-tools__button" disabled={!ready || hasProductBackground(nodes, id)}
      onClick={() => action?.addBackground(id)}>加背景</button>
  </>;
}
/** 商品拆解卡还没出片时上方「加商品 / 加背景」：和卡片工具条一样按屏幕摆，贴边不出屏、不钻进四角按钮栏（11-09）。 */
export function ProductTools({ id, panelBelow }: { id: string; panelBelow?: boolean }) {
  return <NodeToolbar position={Position.Top} offset={10}><ViewportTools panelBelow={panelBelow}><ProductToolButtons id={id} /></ViewportTools></NodeToolbar>;
}
