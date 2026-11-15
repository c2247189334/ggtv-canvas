import type { AssetRef, CardData, FrameRegion } from '@/types';
import type { RewriteItem, RewritePlan } from '@/videoRewriteTypes';
import { newCard } from './cards';

/**
 * 11-11 用户定：人物、每个背景、每套衣服左边各放一张原片同一刻的截图，一行一对、顶边对齐，空卡和截图一样大，一眼看出这格该放什么。
 * 要换的项截图只给人对照、不连线（连线 = 当参考喂进去出图，会照着原片画）；跟原片一致的截图照旧连线当素材。
 */
export type RewriteRow = { left?: string; right: string };

const tenth = (second: number) => Math.round(second * 10) / 10;

/** 截图的宽高比（宽 ÷ 高）：分屏只截半边时那一边减半；原片没量到尺寸就不给。 */
export function frameAspect(source: AssetRef, region?: FrameRegion): number | undefined {
  if (!source.width || !source.height) return undefined;
  const width = region === 'left' || region === 'right' ? source.width / 2 : source.width;
  const height = region === 'top' || region === 'bottom' ? source.height / 2 : source.height;
  return width / height;
}

/** 要换的项看原片哪一秒：衣服用拆解挑的那帧；人用他第一套衣服那帧（露得最全），没衣服取在场的正中；东西整片都算、不知道哪一刻露脸，不截。 */
export function compareSecond(item: RewriteItem, plan: RewritePlan): number | undefined {
  if (item.kind === '衣服') return item.frame;
  if (item.kind !== '人物') return undefined;
  const people = plan.items.filter(entry => entry.kind === '人物').length;
  const first = plan.items.filter(entry => entry.kind === '衣服' && (entry.person === item.id || (!entry.person && people === 1)))
    .sort((a, b) => a.from - b.from)[0];
  return first ? first.frame : Math.round((item.from + item.to) * 50) / 100;
}

/** 对照截图卡：普通上传图，不记来源线、不连任何卡；标题写它对照的是哪张卡、原片第几秒。 */
export function compareCard(frame: AssetRef, name: string, second: number): CardData {
  const card = newCard('upload', 0, [{ ...frame }]);
  card.title = `${name} 原片（${tenth(second)} 秒）`;
  return card;
}
