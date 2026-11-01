import { expect, it } from 'vitest';
import { startVideoRewrite, prepareRewriteCards } from './videoRewrite';
import { newVideoCard } from './cards';
import { pasteClipboard } from './clipboard';
import type { CardNode } from '@/types';
const source = { type: 'upload' as const, id: 'u', media: 'video' as const, seconds: 6, hasAudio: true };
function fixture() {
  const original: CardNode = { id: 's', type: 'card', position: { x: 0, y: 0 },
    data: { ...newVideoCard('upload', 0, [source]), rewriteStatus: { status: 'failed', error: '断线', yuan: 0.02, costUnknown: false } } };
  const args = { source: original, nodes: [original], edges: [], takeNumber: () => 2, makeId: () => crypto.randomUUID(), userText: '换人' };
  const graph = startVideoRewrite(args);
  const state = { ...graph.state, plan: { summary: '人物', items: [{ id: 'p', kind: '人物' as const, desc: '人物', from: 0, to: 6, frame: 0 },
    { id: 'c1', kind: '衣服' as const, desc: '日装', from: 0, to: 2.5, frame: 1 }, { id: 'c2', kind: '衣服' as const, desc: '晚装', from: 2.5, to: 6, frame: 3 }],
    replace: ['p'], actions: [], changes: [{ second: 2.5, how: '扇叶' }], unsure: [] } };
  return { ...prepareRewriteCards({ ...args, ...graph, state }), batchId: graph.batchId };
}
it('整组复制：副本的来源指向原视频副本，单项快照和变化秒数保留，原视频的改写状态不跟着复制', () => {
  const graph = fixture(); let serial = 0;
  const copied = pasteClipboard(graph, null, () => `copy-${++serial}`);
  const sourceCopy = copied.nodes[0];
  const video = copied.nodes.find(n => n.data.kind === 'video' && n.data.source === 'generate')!;
  const image = copied.nodes.find(n => n.data.kind === 'image' && n.data.source === 'generate')!;
  expect(sourceCopy.data).not.toHaveProperty('rewriteStatus');
  expect(video.data).toMatchObject({ rewriteId: graph.batchId, rewriteSourceId: sourceCopy.id, rewriteSource: source, rewriteChangeSeconds: [2.5] });
  expect(image.data).toMatchObject({ rewriteId: graph.batchId, rewriteItem: { id: 'p', desc: '人物' } });
  expect(graph.nodes.find(n => n.id === graph.videoId)?.data).toMatchObject({ rewriteSourceId: 's' });
});
it('单独复制改写视频保留完整来源快照和批次，照常能发', () => {
  const graph = fixture();
  const original = graph.nodes.find(n => n.id === graph.videoId)!;
  const copied = pasteClipboard({ nodes: [original], edges: [] }, null, () => 'copy');
  expect(copied.nodes[0].data).toMatchObject({ rewriteId: graph.batchId, rewriteSourceId: 's', rewriteSource: source });
});
