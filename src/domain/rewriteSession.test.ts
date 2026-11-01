import { expect, it } from 'vitest';
import { newVideoCard } from './cards';
import { fromDoc, readCard, toDoc } from './canvasDoc';
import { pasteClipboard } from './clipboard';
import { emptyHistory, recordHistory, redoHistory, undoHistory } from './history';
import type { CardNode } from '@/types';

const plan = { summary: '展示衣服', items: [{ id: 'p', kind: '人物' as const, desc: '原视频人物', from: 0, to: 6, frame: 1 }],
  changes: [{ second: 2.5, how: '扫过' }], actions: [{ from: 0, to: 6, desc: '跟随动作' }],
  replace: ['p'], unsure: [] };
const data = () => ({ ...newVideoCard('generate', 1), rewriteId: 'r', rewritePlan: structuredClone(plan),
  rewriteUserText: '换成我的人物', rewriteWarnings: ['衣服长短可能受深度影响'] });
const node = (): CardNode => ({ id: 'video', type: 'card', position: { x: 0, y: 0 }, data: data() });

it('拆解单、用户原话、提醒随存档进出，读档复制数据不共用可变数组', () => {
  const original = node();
  const restored = fromDoc(toDoc({ id: 'c', name: '画布' }, [original], []));
  expect(restored.nodes[0].data).toMatchObject({ rewritePlan: plan, rewriteUserText: '换成我的人物', rewriteWarnings: ['衣服长短可能受深度影响'] });
  expect(restored.nodes[0].data).not.toHaveProperty('rewritePromptStartedAt');
  if (restored.nodes[0].data.kind !== 'video') throw Error('缺视频卡');
  expect(restored.nodes[0].data.rewritePlan).not.toBe(original.data.kind === 'video' ? original.data.rewritePlan : undefined);
});

it('旧卡无拆解单仍可读，损坏拆解单丢弃，不把坏数据带入按钮', () => {
  expect(readCard(newVideoCard('generate', 1))).not.toHaveProperty('rewritePlan');
  for (const rewritePlan of [null, {}, { ...plan, items: [] }, { ...plan, replace: ['missing'] },
    { ...plan, items: [{ ...plan.items[0], frame: -1 }] }, { ...plan, changes: [{ second: NaN, how: '变化' }] }]) {
    expect(readCard({ ...data(), rewritePlan })).not.toHaveProperty('rewritePlan');
  }
  expect(readCard({ ...data(), rewriteWarnings: ['正常提醒', 3, null] })).toMatchObject({ rewriteWarnings: ['正常提醒'] });
});

it('复制、删除撤销和重做保留拆解单与提醒，副本和原卡互不影响', () => {
  const graph = { nodes: [node()], edges: [] };
  const copy = pasteClipboard(graph, null, () => 'copy');
  expect(copy.nodes[0].data).toMatchObject({ rewritePlan: plan, rewriteUserText: '换成我的人物', rewriteWarnings: ['衣服长短可能受深度影响'] });
  if (copy.nodes[0].data.kind !== 'video') throw Error('缺视频卡');
  copy.nodes[0].data.rewritePlan!.items[0].desc = '副本新描述';
  expect(graph.nodes[0].data.kind === 'video' && graph.nodes[0].data.rewritePlan!.items[0].desc).toBe('原视频人物');
  const deleted = { nodes: [], edges: [] };
  const undone = undoHistory(recordHistory(emptyHistory(), graph, deleted), deleted);
  expect(undone.graph.nodes[0].data).toMatchObject({ rewritePlan: plan, rewriteWarnings: ['衣服长短可能受深度影响'] });
  expect(redoHistory(undone.history, undone.graph).graph.nodes).toEqual([]);
});
