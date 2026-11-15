/**
 * 「输入已更新」（11-08 用户定）：生成卡出了结果以后，上游参考换了图、连线多了少了、提示词改了，
 * 就在卡标题右边亮一句，提醒这张结果不是按现在的输入做的。
 * 只比「最近一次发送」时记下的输入；老卡没记过就不亮。
 */
import { currentResult } from './cards';
import { productReference } from './productPrompt';
import { refSources, type LinkEdge } from './refs';
import type { CardNode, SentInputs } from '@/types';

type Edges = readonly Pick<LinkEdge, 'source' | 'target'>[];

/** 按连线顺序，每张参考卡当前那张（类型:编号，还没结果写 none）+ 提示词。发送时存进卡里。 */
export function sentInputsOf(nodes: readonly CardNode[], edges: Edges, cardId: string): SentInputs {
  const target = nodes.find(node => node.id === cardId);
  const refs = refSources(edges, cardId).map(id => {
    const upstream = nodes.find(node => node.id === id);
    const ref = upstream ? target ? productReference(upstream, target.data) : currentResult(upstream.data) : null;
    return ref ? `${ref.type}:${ref.id}` : 'none';
  });
  return { refs, prompt: target?.data.prompt.trim() ?? '' };
}

/** 读存档：形状不对就当没记过。 */
export function readSentInputs(raw: unknown): SentInputs | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { refs, prompt } = raw as Record<string, unknown>;
  return Array.isArray(refs) && refs.every(ref => typeof ref === 'string') && typeof prompt === 'string'
    ? { refs: [...refs] as string[], prompt } : undefined;
}

/** 和发送时比，哪些输入变了；没记过就当没变。 */
export function inputChanges(sent: SentInputs | undefined, now: SentInputs): string[] {
  if (!sent) return [];
  const changes: string[] = [];
  if (sent.prompt !== now.prompt) changes.push('提示词改过');
  const swapped = sent.refs.slice(0, now.refs.length).flatMap((ref, index) => ref === now.refs[index] ? [] : [index + 1]);
  if (swapped.length) changes.push(`第 ${swapped.join('、')} 个参考换了`);
  if (now.refs.length > sent.refs.length) changes.push(`多连了 ${now.refs.length - sent.refs.length} 个参考`);
  if (now.refs.length < sent.refs.length) changes.push(`少了 ${sent.refs.length - now.refs.length} 个参考`);
  return changes;
}

/** 卡标题右边要不要亮：生成卡、有结果、没在生成。返回原因（空字符串 = 不亮），给画布库 useStore 当选择器用。 */
export function staleNote(nodes: readonly CardNode[], edges: Edges, cardId: string): string {
  const card = nodes.find(node => node.id === cardId)?.data;
  if (!card || card.source !== 'generate' || !card.sentInputs || !card.results.length || card.jobs.length) return '';
  return inputChanges(card.sentInputs, sentInputsOf(nodes, edges, cardId)).join('；');
}
