/**
 * 11-13 改写背景卡「不出图，用文字」（设计 docs/specs/2026-11-12-背景卡用文字-design.md）：
 * 点了以后这张卡到视频卡的线剪掉，卡上写一句大白话；「生成提示词」时连同原片那一段的截图交给本机 agent 写进提示词。
 * 线就是开关：用文字时自己拖线连回视频卡 = 改回用图（useCards.connect）；用图时剪线不会变成用文字。
 * 11-16 衣服卡、东西卡（道具 / 遮挡物 / 其他）也能用文字（设计 docs/specs/2026-11-16-衣服卡和东西卡用文字-design.md）；人物卡、商品拆解的卡不行。
 */
import type { Edge } from '@xyflow/react';
import type { CardData, CardNode, ImageCardData, SceneRead, VideoCardData } from '@/types';
import type { ItemText, SceneText } from '@/videoRewriteApiTypes';
import { cardTitle } from './cards';
import { itemPurpose } from './videoRewrite';
import { rewritePeers } from './rewritePeers';

export const MAX_SCENE_TEXT = 300;
export const SCENE_TEXT_PLACEHOLDER = '写这一段想要的背景，大白话就行，比如：球都换成篮球；和原片一样就写「跟原来一样」';
export const SCENE_TEXT_HINT = '不想出图可以点卡上的「不出图，用文字」';
export const CLOTHES_TEXT_PLACEHOLDER = '写这套衣服想要的样子，大白话就行，比如：黄色篮球背心和短裤，帽子不要；和原片一样就写「跟原来一样」';
export const THING_TEXT_PLACEHOLDER = '写这样东西想换成什么，大白话就行，比如：银色的金属球棒';
const TEXT_KINDS = ['衣服', '道具', '遮挡物', '其他'];

/** 视频改写铺出来的背景卡：同一改写、不是人物 / 衣服、不是商品拆解的卡。 */
export function isRewriteBackground(data: CardData): data is ImageCardData {
  return data.kind === 'image' && data.source === 'generate' && Boolean(data.rewriteId) && !data.rewriteItem && !data.productRole;
}
export const usesSceneText = (data: CardData): data is ImageCardData => isRewriteBackground(data) && data.rewriteTextOn === true;
/** 视频改写铺出来的衣服卡、东西卡（人物卡不算）。 */
export function isRewriteItemCard(data: CardData): data is ImageCardData {
  return data.kind === 'image' && data.source === 'generate' && Boolean(data.rewriteId) && !data.productRole && TEXT_KINDS.includes(data.rewriteItem?.kind ?? '');
}
/** 能点「不出图，用文字」的卡；开着用文字的卡。 */
export const canUseText = (data: CardData): data is ImageCardData => isRewriteBackground(data) || isRewriteItemCard(data);
export const usesText = (data: CardData): data is ImageCardData => canUseText(data) && data.rewriteTextOn === true;
export const textPlaceholder = (data: ImageCardData) => !data.rewriteItem ? SCENE_TEXT_PLACEHOLDER : data.rewriteItem.kind === '衣服' ? CLOTHES_TEXT_PLACEHOLDER : THING_TEXT_PLACEHOLDER;

/** 这张背景卡所属的改写视频卡（商品拆解的不算）。 */
export function rewriteVideoOf(nodes: readonly CardNode[], data: ImageCardData): CardNode | undefined {
  return nodes.find(node => node.data.kind === 'video' && node.data.rewriteId === data.rewriteId && Boolean(node.data.rewriteSourceId)
    && node.data.rewriteKind !== 'product');
}

/** 同一改写里开着用文字的背景卡，按卡的序号排，拼成「生成提示词」请求里的 sceneTexts。 */
export function sceneTextsOf(nodes: readonly CardNode[], video: VideoCardData): SceneText[] {
  if (!video.rewriteId) return [];
  return nodes.filter(node => usesSceneText(node.data) && node.data.rewriteId === video.rewriteId)
    .sort((a, b) => a.data.number - b.data.number)
    .map(node => {
      const data = node.data as ImageCardData;
      return { cardId: node.id, title: cardTitle(data), ...(data.rewriteSceneId ? { sceneId: data.rewriteSceneId } : {}), text: (data.rewriteSceneText ?? '').trim() };
    });
}

/** 同一改写里开着用文字的衣服卡 / 东西卡，拼成请求里的 itemTexts；卡名和素材表、小服务同一套编号（「衣服 2」「道具」），不跟着卡的标题走。 */
export function itemTextsOf(nodes: readonly CardNode[], video: VideoCardData, edges: readonly Pick<Edge, 'source' | 'target'>[] = []): ItemText[] {
  if (!video.rewriteId) return [];
  const videoId = nodes.find(node => node.data === video)?.id ?? nodes.find(node => node.data.kind === 'video' && node.data.rewriteId === video.rewriteId
    && Boolean(node.data.rewriteSourceId) && node.data.rewriteKind !== 'product')?.id;
  const peers = videoId ? rewritePeers(nodes, edges, videoId) : [];
  return nodes.filter(node => isRewriteItemCard(node.data) && node.data.rewriteTextOn === true && node.data.rewriteId === video.rewriteId)
    .sort((a, b) => a.data.number - b.data.number)
    .map(node => {
      const data = node.data as ImageCardData, item = data.rewriteItem!;
      return { cardId: node.id, title: itemPurpose(item, peers).replace(/（.*$/, '').trim(), itemId: item.id, text: (data.rewriteSceneText ?? '').trim() };
    });
}
/** 背景、衣服、东西卡的字排在一起：查空字、对回显、查改没改过都用它。 */
export const cardTextsOf = (nodes: readonly CardNode[], video: VideoCardData, edges: readonly Pick<Edge, 'source' | 'target'>[] = []): Array<SceneText | ItemText> =>
  [...sceneTextsOf(nodes, video), ...itemTextsOf(nodes, video, edges)];

/** 用文字的段管哪些场景：换装 / 换场秒数要把这些段算进去（和小服务 scenesInUse 一致）。 */
export const sceneTextIds = (nodes: readonly CardNode[], video: VideoCardData): string[] =>
  sceneTextsOf(nodes, video).flatMap(row => row.sceneId ? [row.sceneId] : []);

/** 选了用文字却一个字没写：拦「生成提示词」。 */
export function sceneTextProblem(texts: readonly Pick<SceneText, 'title' | 'text'>[]): string | null {
  const empty = texts.find(row => !row.text);
  return empty ? `${empty.title} 选了用文字，还没写字` : null;
}

/** 生成提示词之后又改了卡上的字、或者切换了用文字 / 用图：只出红字提醒，不拦发送。 */
export function sceneTextStaleNotes(nodes: readonly CardNode[], video: VideoCardData, edges: readonly Pick<Edge, 'source' | 'target'>[] = []): string[] {
  if (!video.rewriteId || video.rewriteKind === 'product' || !video.prompt.trim()) return [];
  const current = cardTextsOf(nodes, video, edges), reads = video.rewriteSceneReads;
  if (!reads) return current.map(row => `${row.title} 选了用文字，提示词里还没有这段的字，再点一次「生成提示词」`);
  const notes = current.filter(row => reads.find(read => read.cardId === row.cardId)?.text !== row.text)
    .map(row => `${row.title} 的字在生成提示词之后改过，再点一次「生成提示词」`);
  for (const read of reads) {
    if (read.cardId && nodes.some(node => node.id === read.cardId) && !current.some(row => row.cardId === read.cardId)) {
      notes.push(`${read.title} 在生成提示词之后改回了用图，再点一次「生成提示词」`);
    }
  }
  return notes;
}

/** 回显带上卡的编号（按卡名对），之后才能判断哪张卡的字改过。 */
export function attachReadCards(reads: readonly SceneRead[] | undefined, texts: readonly Pick<SceneText, 'title' | 'cardId'>[] | undefined): SceneRead[] | undefined {
  if (!reads?.length) return undefined;
  return reads.map(read => {
    const cardId = texts?.find(row => row.title === read.title)?.cardId;
    return { ...read, ...(cardId ? { cardId } : {}) };
  });
}

export function readSceneReads(value: unknown): SceneRead[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value.slice(0, 30).flatMap(row => {
    const r = (row ?? {}) as Record<string, unknown>;
    if (typeof r.title !== 'string' || typeof r.text !== 'string' || typeof r.read !== 'string') return [];
    return [{ title: r.title, text: r.text, read: r.read, ...(typeof r.cardId === 'string' ? { cardId: r.cardId } : {}) }];
  });
  return rows.length ? rows : undefined;
}
