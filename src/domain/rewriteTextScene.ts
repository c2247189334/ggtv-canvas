/**
 * 11-13 改写背景卡「不出图，用文字」（设计 docs/specs/2026-11-12-背景卡用文字-design.md）：
 * 点了以后这张卡到视频卡的线剪掉，卡上写一句大白话；「生成提示词」时连同原片那一段的截图交给本机 agent 写进提示词。
 * 线就是开关：用文字时自己拖线连回视频卡 = 改回用图（useCards.connect）；用图时剪线不会变成用文字。
 */
import type { CardData, CardNode, ImageCardData, SceneRead, VideoCardData } from '@/types';
import type { SceneText } from '@/videoRewriteApiTypes';
import { cardTitle } from './cards';

export const MAX_SCENE_TEXT = 300;
export const SCENE_TEXT_PLACEHOLDER = '写这一段想要的背景，大白话就行，比如：球都换成篮球；和原片一样就写「跟原来一样」';
export const SCENE_TEXT_HINT = '不想出图可以点卡上的「不出图，用文字」';

/** 视频改写铺出来的背景卡：同一改写、不是人物 / 衣服、不是商品拆解的卡。 */
export function isRewriteBackground(data: CardData): data is ImageCardData {
  return data.kind === 'image' && data.source === 'generate' && Boolean(data.rewriteId) && !data.rewriteItem && !data.productRole;
}
export const usesSceneText = (data: CardData): data is ImageCardData => isRewriteBackground(data) && data.rewriteTextOn === true;

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

/** 用文字的段管哪些场景：换装 / 换场秒数要把这些段算进去（和小服务 scenesInUse 一致）。 */
export const sceneTextIds = (nodes: readonly CardNode[], video: VideoCardData): string[] =>
  sceneTextsOf(nodes, video).flatMap(row => row.sceneId ? [row.sceneId] : []);

/** 选了用文字却一个字没写：拦「生成提示词」。 */
export function sceneTextProblem(texts: readonly SceneText[]): string | null {
  const empty = texts.find(row => !row.text);
  return empty ? `${empty.title} 选了用文字，还没写字` : null;
}

/** 生成提示词之后又改了卡上的字、或者切换了用文字 / 用图：只出红字提醒，不拦发送。 */
export function sceneTextStaleNotes(nodes: readonly CardNode[], video: VideoCardData): string[] {
  if (!video.rewriteId || video.rewriteKind === 'product' || !video.prompt.trim()) return [];
  const current = sceneTextsOf(nodes, video), reads = video.rewriteSceneReads;
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
export function attachReadCards(reads: readonly SceneRead[] | undefined, texts: readonly SceneText[] | undefined): SceneRead[] | undefined {
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
