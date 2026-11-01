import { expect, it } from 'vitest';
import { startVideoRewrite, prepareRewriteCards } from './videoRewrite';
import { newVideoCard, cardCounter } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { restoreRewriteProgress } from './rewriteProgress';
import { pasteClipboard } from './clipboard';
import { emptyHistory, recordHistory, undoHistory, redoHistory } from './history';
import type { CardNode } from '@/types';

const source: CardNode = { id: 'source', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
  [{ type: 'upload', id: 'u', media: 'video', seconds: 6, width: 720, height: 1280, hasAudio: true }]) };
const args = () => ({ source, nodes: [source], edges: [], takeNumber: cardCounter(), makeId: () => crypto.randomUUID(), userText: '换人' });
const output = (nodes: CardNode[]) => nodes.find(node => node.data.kind === 'video' && node.data.source === 'generate')!;
const plan = { summary: '换人', items: [{ id: 'p', kind: '人物' as const, desc: '人物', from: 0, to: 6, frame: 1 }],
  replace: ['p'], changes: [], actions: [], unsure: [] };

it('开跑即在第四列建最终视频，分析成功只填同一id，位置和视频设置不变', () => {
  const options = args(), started = startVideoRewrite(options), early = output(started.nodes);
  expect(early).toBeDefined();
  expect(early.position).toEqual({ x: 1140, y: 0 });
  expect(early.data).toMatchObject({ prompt: '', rewriteSourceId: 'source', rewriteSource: source.data.results[0], rewriteStatus: { status: 'pending' },
    video: { model: 'doubao-seedance-2-5-260628', mode: 'reference', ratio: '9:16', resolution: '480p', duration: 6, audio: false, count: 1 } });
  const prepared = prepareRewriteCards({ ...options, ...started, state: { ...started.state, plan } });
  expect(prepared.videoId).toBe(early.id);
  expect(output(prepared.nodes).position).toEqual(early.position);
  expect(output(prepared.nodes).data).toMatchObject({ rewritePlan: plan, prompt: '', video: early.data.video });
  expect(output(prepared.nodes).data).not.toHaveProperty('rewriteStatus');
  expect(prepared.nodes.filter(node => node.data.source === 'generate' && node.data.kind === 'video')).toHaveLength(1);
});

it('中断输出存档进出，失败后复用；已铺好单子的输出不复用', () => {
  const options = args(), started = startVideoRewrite(options), early = output(started.nodes);
  expect(early).toBeDefined();
  const restored = fromDoc(toDoc({ id: 'c', name: '画布' }, started.nodes, started.edges));
  expect(output(restored.nodes).data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
  const retried = startVideoRewrite({ ...options, ...restored });
  expect(output(retried.nodes).id).toBe(early.id);
  expect(retried.nodes).toHaveLength(started.nodes.length);
  const prepared = prepareRewriteCards({ ...options, ...retried, state: { ...retried.state, plan } });
  const again = startVideoRewrite({ ...options, ...prepared });
  expect(again.nodes.filter(node => node.data.source === 'generate' && node.data.kind === 'video')).toHaveLength(2);
});

it('输出同源进度撤销重做恢复为中断，成组复制保持来源关系且不复制忙状态', () => {
  const options = args(), started = startVideoRewrite(options), early = output(started.nodes);
  expect(early).toBeDefined();
  early.data = { ...early.data, rewriteBusy: 'analyzing' };
  expect(restoreRewriteProgress(started.nodes, new Set([source.id, early.id]))).toBe(started.nodes);
  const restored = restoreRewriteProgress(started.nodes, new Set());
  expect(output(restored).data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
  const before = { nodes: [source], edges: [] };
  const undone = undoHistory(recordHistory(emptyHistory(), before, started), started);
  expect(undone.graph.nodes).toHaveLength(1);
  const redone = redoHistory(undone.history, undone.graph);
  expect(output(restoreRewriteProgress(redone.graph.nodes, new Set())).data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
  let serial = 0;
  const copied = pasteClipboard(started, null, () => `copy-${++serial}`);
  expect(output(copied.nodes).data).toMatchObject({ rewriteSourceId: copied.nodes[0].id });
  expect(output(copied.nodes).data).not.toHaveProperty('rewriteBusy');
  expect(output(copied.nodes).data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
});
