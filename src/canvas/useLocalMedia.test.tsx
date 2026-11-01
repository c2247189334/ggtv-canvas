import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import { api } from '@/api';
import { newVideoCard } from '@/domain/cards';
import type { CardNode } from '@/types';
import { useLocalMedia } from './useLocalMedia';

const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); } }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNode: (id: string) => graph.nodes.find(node => node.id === id), getNodes: () => graph.nodes, getInternalNode: () => undefined }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), submitMeshJob: vi.fn(), submitDepthJob: vi.fn(), extractAudio: vi.fn(), getDepthJobs: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ bumpWorks: vi.fn() }));

function setup() {
  const notify = vi.fn();
  let run!: ReturnType<typeof useLocalMedia>;
  function Harness() {
    run = useLocalMedia({ canvasId: 'c', nodes: graph.nodes,
      setNodes: update => { graph.nodes = update(graph.nodes); }, setEdges: update => { graph.edges = update(graph.edges); }, takeNumber: () => 2, notify });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const cleanup = graph.effects.splice(0).map(effect => effect());
  return { run, notify, cleanup: () => cleanup.forEach(fn => fn?.()) };
}
beforeEach(() => {
  vi.clearAllMocks(); graph.edges = []; graph.effects = [];
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 0, y: 0 },
    data: newVideoCard('upload', 1, [{ type: 'upload', id: 'upload', media: 'video', seconds: 6 }]) }];
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitMeshJob).mockResolvedValue({ id: 'mesh-job' });
  vi.mocked(api.submitDepthJob).mockResolvedValue({ id: 'depth-job' });
  vi.stubGlobal('window', { setInterval: vi.fn(() => 1), clearInterval: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it('深度确认前ffprobe缺少或未知均不建卡、不连线、不交单', async () => {
  const ready = { filled: true, found: true };
  for (const ffprobeFound of [false, undefined]) {
    vi.mocked(api.health).mockResolvedValue({ ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0,
      ffmpegFound: true, ffprobeFound, depth: { python: ready, modelDir: ready, extraPackages: ready } });
    const { run, notify } = setup(), before = structuredClone(graph.nodes);
    await run('source', 'depth');
    expect(graph.nodes).toEqual(before); expect(graph.edges).toHaveLength(0);
    expect(api.submitDepthJob).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('ffprobe'));
  }
});

it('工具确认白模只交白模单、不带清晰度，建卡、来源线、单号沿用深度接线', async () => {
  const { run } = setup();
  await run('source', 'mesh', '720p');
  expect(api.submitMeshJob).toHaveBeenCalledWith({ source: { type: 'upload', id: 'upload' }, canvasId: 'c', cardId: graph.nodes[1].id });
  expect(api.submitDepthJob).not.toHaveBeenCalled();
  expect(graph.nodes[1].data).toMatchObject({ source: 'mesh', depthJobId: 'mesh-job', mediaSource: graph.nodes[0].data.results[0] });
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: 'source', target: graph.nodes[1].id }));
  vi.mocked(api.getDepthJobs).mockResolvedValue([{ id: 'mesh-job', kind: 'mesh', status: 'succeeded', phase: null, error: null,
    errorCode: null, source: { type: 'upload', id: 'upload' }, resolution: '480p', count: 1, createdAt: '', works: ['work'] }]);
  const polling = setup();
  // Effect 已发起请求；等回包后同一收单函数写入白模标记。
  await vi.waitFor(() => expect(graph.nodes[1].data.results).toEqual([{ type: 'work', id: 'work', media: 'video', mesh: true }]));
  expect(window.setInterval).toHaveBeenCalledWith(expect.any(Function), 2000);
  polling.cleanup();
});

it('白模交单失败原话写卡上，清单号计时；体检缺项不建卡不交单', async () => {
  vi.mocked(api.submitMeshJob).mockRejectedValueOnce(Error('ComfyUI 失败原话'));
  await setup().run('source', 'mesh');
  expect(graph.nodes[1].data).toMatchObject({ note: 'ComfyUI 失败原话', depthJobId: undefined, startedAt: undefined });
  graph.nodes = graph.nodes.slice(0, 1);
  vi.mocked(api.health).mockResolvedValue({ fake: false, ffmpegFound: true,
    mesh: { url: { filled: true, found: false }, directory: { filled: false, found: false } } } as Awaited<ReturnType<typeof api.health>>);
  const blocked = setup(); await blocked.run('source', 'mesh');
  expect(graph.nodes).toHaveLength(1); expect(api.submitMeshJob).toHaveBeenCalledTimes(1);
  expect(blocked.notify).toHaveBeenCalledWith(expect.stringContaining('COMFYUI_URL'));
});

it('默认本机地址合法但未探活成功，点白模仍不建卡和交单', async () => {
  vi.mocked(api.health).mockResolvedValue({ fake: false, ffmpegFound: true,
    mesh: { ready: false, url: { filled: false, found: true }, directory: { filled: false, found: false } } } as Awaited<ReturnType<typeof api.health>>);
  const { run, notify } = setup();
  await run('source', 'mesh');
  expect(graph.nodes).toHaveLength(1); expect(graph.edges).toHaveLength(0);
  expect(api.submitMeshJob).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('打开 ComfyUI'));
});
