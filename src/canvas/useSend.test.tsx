import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { newCard, newVideoCard } from '@/domain/cards';
import { api } from '@/api';
import { useSend } from './useSend';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[] }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), checkVideoPrompt: vi.fn(), submitVideoJob: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ isWorkDeleted: () => false }));
function setup(rewrite = true) {
  const card = newVideoCard('generate', 2); card.prompt = '@图片1 提供形象。0-5秒人物跳舞。';
  card.video.model = 'doubao-seedance-2-5-260628';
  if (rewrite) { card.rewriteId = 'batch'; card.rewriteChangeSeconds = [2.5, 4]; }
  graph.nodes = [{ id: 'image', type: 'card', position: { x: 0, y: 0 }, data: newCard('upload', 1, [{ type: 'upload', id: 'u' }]) },
    { id: 'video', type: 'card', position: { x: 800, y: 0 }, data: card }];
  graph.edges = [{ id: 'i-v', source: 'image', target: 'video' }];
  let send!: ReturnType<typeof useSend>;
  function Harness() { send = useSend('canvas', update => { graph.nodes = update(graph.nodes); }); return null; }
  renderToStaticMarkup(<Harness />); return send;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitVideoJob).mockResolvedValue({ id: 'job' });
  vi.mocked(api.checkVideoPrompt).mockResolvedValue({ issues: [], yuan: 0 });
});
it('改写出来的视频卡发送前做免费检查，有问题或检查失败都不交单', async () => {
  const send = setup();
  vi.mocked(api.checkVideoPrompt).mockResolvedValueOnce({ issues: ['提示词含编辑触发词：替换'], yuan: 0 });
  await expect(send('video')).rejects.toThrow('替换');
  expect(api.submitVideoJob).not.toHaveBeenCalled();
  expect(api.checkVideoPrompt).toHaveBeenCalledWith({ cardId: 'video', videoPrompt: graph.nodes[1].data.prompt, duration: 5,
    materials: [{ tag: '@图片1', purpose: '图片参考' }], changeSeconds: [2.5, 4] });
  vi.mocked(api.checkVideoPrompt).mockRejectedValueOnce(Error('免费检查断线'));
  await expect(send('video')).rejects.toThrow('免费检查断线'); expect(api.submitVideoJob).not.toHaveBeenCalled();
});
it('尚未拆好的输出即使手填了词也不能发送，不触发检查和交单', async () => {
  for (const status of ['pending', 'interrupted', 'failed'] as const) {
    const send = setup();
    graph.nodes[1].data.rewriteStatus = status === 'failed'
      ? { status, error: '豆包失败原话', yuan: 0.02, costUnknown: false } : { status };
    await expect(send('video')).rejects.toThrow(status === 'pending' ? '正在拆解视频' : status === 'failed' ? '豆包失败原话' : '上次没做完');
    expect(api.checkVideoPrompt).not.toHaveBeenCalled(); expect(api.submitVideoJob).not.toHaveBeenCalled();
  }
});
it('检查通过的改写视频仍带reference，普通卡不调用该检查', async () => {
  const send = setup(); await send('video');
  expect(api.submitVideoJob).toHaveBeenCalledWith(expect.objectContaining({ taskType: 'reference' }));
  vi.clearAllMocks(); const ordinary = setup(false); await ordinary('video');
  expect(api.checkVideoPrompt).not.toHaveBeenCalled();
  expect(api.submitVideoJob).toHaveBeenCalledWith(expect.not.objectContaining({ taskType: expect.anything() }));
});
it('发送前检查携带图片快照原描述，命中后不交视频单', async () => {
  const send = setup();
  const item = { id: 'person', kind: '人物' as const, desc: '原片中金色长发的年轻女子', from: 0, to: 5, frame: 1 };
  if (graph.nodes[0].data.kind !== 'image') throw Error('测试前置图片卡不存在');
  graph.nodes[0].data.rewriteItem = item;
  vi.mocked(api.checkVideoPrompt).mockResolvedValueOnce({ issues: ['原描述不能写进视频提示词'], yuan: 0 });
  await expect(send('video')).rejects.toThrow('原描述');
  expect(api.checkVideoPrompt).toHaveBeenCalledWith(expect.objectContaining({ materials: [
    { tag: '@图片1', purpose: '人物', itemId: item.id, originalDesc: item.desc }
  ] }));
  expect(api.submitVideoJob).not.toHaveBeenCalled();
});
