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
vi.mock('@/api', () => ({ api: { health: vi.fn(), checkVideoPrompt: vi.fn(), submitVideoJob: vi.fn(), findOrphanJobs: vi.fn() } }));
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
  vi.mocked(api.findOrphanJobs).mockResolvedValue([]);
});
it('11-15 交单回话丢了但小服务其实接了单：接回卡片、记下当时输入，提示别再点；第 2 单丢时第 1 单不重复加', async () => {
  const send = setup(false);
  vi.mocked(api.submitVideoJob).mockRejectedValueOnce(Error('连不上小服务'));
  vi.mocked(api.findOrphanJobs).mockResolvedValueOnce([{ id: 'lost', cardId: 'video', kind: 'video' }]);
  await expect(send('video')).rejects.toThrow(/已经交上去了.*不用再点发送/);
  expect(api.findOrphanJobs).toHaveBeenCalledWith('canvas', ['video']);
  expect(graph.nodes[1].data.jobs).toEqual(['lost']); expect(graph.nodes[1].data.sentInputs).toBeDefined();

  const batch = setup(false);
  if (graph.nodes[1].data.kind !== 'video') throw Error('测试前置视频卡不存在');
  graph.nodes[1].data.video.count = 2;
  vi.mocked(api.submitVideoJob).mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(Error('连不上小服务'));
  vi.mocked(api.findOrphanJobs).mockResolvedValueOnce([{ id: 'first', cardId: 'video', kind: 'video' }, { id: 'second', cardId: 'video', kind: 'video' }]);
  await expect(batch('video')).rejects.toThrow(/已经交上去了/);
  expect(graph.nodes[1].data.jobs).toEqual(['first', 'second']);
});
it('一次设了 4 条、第 2 条回话丢了：接回后说清后面 2 条没发，不说「不用再点」', async () => {
  const send = setup(false);
  if (graph.nodes[1].data.kind !== 'video') throw Error('测试前置视频卡不存在');
  graph.nodes[1].data.video.count = 4;
  vi.mocked(api.submitVideoJob).mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(Error('连不上小服务'));
  vi.mocked(api.findOrphanJobs).mockResolvedValueOnce([{ id: 'second', cardId: 'video', kind: 'video' }]);
  const error = await send('video').then(() => null, (e: Error) => e);
  expect(error?.message).toMatch(/已经交上去了/); expect(error?.message).toMatch(/设了 4 条.*交上 2 条.*后面 2 条没发.*数量改成 2/);
  expect(error?.message).not.toMatch(/不用再点/);
  expect(api.submitVideoJob).toHaveBeenCalledTimes(2); expect(graph.nodes[1].data.jobs).toEqual(['first', 'second']);
});
it('小服务明确拒单（4xx）：不去找丢单，照原话报错', async () => {
  const send = setup(false);
  vi.mocked(api.submitVideoJob).mockRejectedValueOnce(Object.assign(Error('参考图找不到了'), { status: 400 }));
  vi.mocked(api.findOrphanJobs).mockResolvedValue([{ id: 'other-tab', cardId: 'video', kind: 'video' }]);
  await expect(send('video')).rejects.toThrow('参考图找不到了');
  expect(api.findOrphanJobs).not.toHaveBeenCalled(); expect(graph.nodes[1].data.jobs).toEqual([]);
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
      ? { status, error: '豆包失败原话' } : { status };
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
it('11-08 输入已更新：交上单后记下当时的参考和提示词，没交上不记', async () => {
  const send = setup(false); await send('video');
  expect(graph.nodes[1].data.sentInputs).toEqual({ refs: ['upload:u'], prompt: '@图片1 提供形象。0-5秒人物跳舞。' });
  const failed = setup(false);
  vi.mocked(api.submitVideoJob).mockRejectedValueOnce(Error('火山拒收'));
  await expect(failed('video')).rejects.toThrow('火山拒收');
  expect(graph.nodes[1].data.sentInputs).toBeUndefined();
});
