import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import type { RewriteItem } from '@/videoRewriteTypes';

/** 能「不出图，用文字」的种类（人物不行），和小服务 server/videoRewrite/itemTexts.mjs 的 TEXT_KINDS 一致。 */
export const TEXT_KINDS: readonly string[] = ['衣服', '道具', '遮挡物', '其他'];

/**
 * 排「衣服 N」「人物 N」用的名单。和小服务 server/videoRewrite/roles.mjs 的 labelPeers 是同一条规矩，两边一起改：
 * 连着图的 + 用文字的 + 要换却没连图的衣服。只看拆解单、连线和用文字的开关，不看卡删没删——
 * 11-17 审查：页面按「还在画布上的卡」排、小服务按拆解单排，删掉一张衣服卡再让另一张用文字，同一个号会指两套衣服。
 */
export function rewritePeers(nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId: string): RewriteItem[] {
  const video = nodes.find(node => node.id === videoId)?.data;
  const inputs = new Set(edges.filter(edge => edge.target === videoId).map(edge => edge.source));
  const cards = nodes.flatMap(node => node.data.kind === 'image' && node.data.rewriteItem ? [{ id: node.id, data: node.data, item: node.data.rewriteItem }] : []);
  const linkedItems = cards.filter(card => inputs.has(card.id)).map(card => card.item);
  const plan = video?.kind === 'video' ? video.rewritePlan : undefined;
  // 旧卡没存拆解单：只能按连着的卡排。
  if (!plan || video?.kind !== 'video') return linkedItems.filter((item, index) => linkedItems.findIndex(other => other.id === item.id) === index);
  const linked = new Set(linkedItems.map(item => item.id));
  const texts = new Set(cards.filter(card => card.data.rewriteTextOn === true && card.data.source === 'generate' && !card.data.productRole
    && Boolean(video.rewriteId) && card.data.rewriteId === video.rewriteId && TEXT_KINDS.includes(card.item.kind)).map(card => card.item.id));
  const on = (id: string) => linked.has(id) || texts.has(id);
  return plan.items.filter(item => (linked.has(item.id) && (plan.replace.includes(item.id) || item.kind === '衣服')) || texts.has(item.id)
    || (item.kind === '衣服' && plan.replace.includes(item.id) && !on(item.id) && !(item.sameAs && on(item.sameAs))));
}
