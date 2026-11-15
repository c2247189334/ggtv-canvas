import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { newCard, newVideoCard } from '@/domain/cards';
import { api } from '@/api';
import { useSend } from './useSend';
import { productPromptRequest } from '@/domain/productPrompt';
const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges, getNode: (id: string) => graph.nodes.find(n => n.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), checkProductPrompt: vi.fn(), checkVideoPrompt: vi.fn(), submitVideoJob: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ isWorkDeleted: () => false }));
function setup() {
  const card = newVideoCard('generate', 2); card.rewriteId = 'batch'; card.rewriteKind = 'product'; card.rewriteSourceId = 'source';
  card.rewriteSource = { type: 'upload', id: 'original', media: 'video', seconds: 6, hasAudio: true };
  card.productPlan = { products: [{ id: 'A', name: '鞋子', look: '原鞋', pairs: 1, pieces: 2, layout: '脚上' }], visible: '脚', face: false, looks: [], timeline: [{ from: 0, to: 6, action: '迈步' }], unsure: [] };
  card.video = { ...card.video, model: 'doubao-seedance-2-0-260128', audio: false, duration: 6 };
  card.prompt = '@视频1 是动作、运镜参考。@图片1 是商品。0-6 秒：迈步。不要字幕。';
  graph.nodes = [{ id: 'source', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 0, [{ ...card.rewriteSource, id: 'later-page' }]) },
    { id: 'image', type: 'card', position: { x: 400, y: 0 }, data: { ...newCard('generate', 1, [{ type: 'upload', id: 'image' }]), productRole: { role: 'product' as const, videoId: 'v', productId: 'A' } } },
    { id: 'v', type: 'card', position: { x: 800, y: 0 }, data: card }];
  graph.edges = [{ id: 's-v', source: 'source', target: 'v' }, { id: 'i-v', source: 'image', target: 'v' }];
  let send!: ReturnType<typeof useSend>;
  function Harness() { send = useSend('c', update => { graph.nodes = update(graph.nodes); }); return null; }
  renderToStaticMarkup(<Harness />); return { send, card };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.checkProductPrompt).mockResolvedValue({ issues: [], yuan: 0 }); vi.mocked(api.submitVideoJob).mockResolvedValue({ id: 'job' });
});
it('发送前用商品版检查，失败不交单；通过时发送锁定的原片和商品/原声，2.0不带taskType', async () => {
  const { send, card } = setup(); vi.mocked(api.checkProductPrompt).mockResolvedValueOnce({ issues: ['@图片1 没身份'], yuan: 0 });
  await expect(send('v')).rejects.toThrow('没身份'); expect(api.submitVideoJob).not.toHaveBeenCalled();
  expect(api.checkProductPrompt).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'v', plan: card.productPlan,
    materials: [expect.objectContaining({ tag: '@视频1' }), expect.objectContaining({ tag: '@图片1', role: 'product', productId: 'A', originalDesc: '原鞋' })] }));
  expect(api.checkVideoPrompt).not.toHaveBeenCalled(); await send('v');
  expect(api.submitVideoJob).toHaveBeenCalledWith(expect.objectContaining({ soundtrack: { type: 'upload', id: 'original' }, refs: [{ type: 'upload', id: 'original' }, { type: 'upload', id: 'image' }] }));
  expect(vi.mocked(api.submitVideoJob).mock.calls[0][0]).not.toHaveProperty('taskType');
});
it('生成提示词取商品身份、原视频快照和视频设置（看图定稿用），免费检查网络失败不交单', async () => {
  const { send, card } = setup(); const request = productPromptRequest({ id: 'v', data: card, nodes: graph.nodes, edges: graph.edges });
  expect(request.settings).toEqual({ model: card.video.model, ratio: card.video.ratio, resolution: card.video.resolution, duration: card.video.duration, audio: card.video.audio });
  expect(request.materials[1]).toMatchObject({ role: 'product', productId: 'A', asset: { id: 'image' } });
  expect(request.materials[0].asset?.id).toBe('original');
  vi.mocked(api.checkProductPrompt).mockRejectedValueOnce(Error('检查断线'));
  await expect(send('v')).rejects.toThrow('检查断线'); expect(api.submitVideoJob).not.toHaveBeenCalled();
});
