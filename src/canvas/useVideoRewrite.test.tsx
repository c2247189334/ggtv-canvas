import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Edge } from '@xyflow/react';
import type { CardNode } from '@/types';
import { cardCounter, newVideoCard } from '@/domain/cards';
import { videoRewriteMaterials, REWRITE_NEW_SCENE_PROMPT } from '@/domain/videoRewrite';
import { api } from '@/api';
import { useVideoRewrite } from './useVideoRewrite';
import type { RewritePlan } from '@/videoRewriteTypes';
const graph = vi.hoisted(() => ({ nodes: [] as CardNode[], edges: [] as Edge[], effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async importOriginal => ({ ...await importOriginal<typeof import('react')>(),
  useEffect: (effect: () => void | (() => void)) => { graph.effects.push(effect); } }));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => graph.nodes, getEdges: () => graph.edges,
  getNode: (id: string) => graph.nodes.find(node => node.id === id) }) }));
vi.mock('@/api', () => ({ api: { health: vi.fn(), analyzeVideo: vi.fn(), writeVideoPrompt: vi.fn(), submitDepthJob: vi.fn(), submitMeshJob: vi.fn(), extractAudio: vi.fn(), extractFrame: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ bumpWorks: vi.fn() }));
const meta = { duration: 6, targetDuration: 6, ratio: '9:16' as const, hasAudio: true };
const plan: RewritePlan = { summary: '换装', items: [
  { id: 'person', kind: '人物', desc: '一名人物', from: 0, to: 6, frame: 0 },
  ...[1, 2, 3, 4].map(n => ({ id: `dress${n}`, kind: '衣服' as const, desc: `第${n}套`, from: (n - 1) * 1.5, to: n * 1.5, frame: n }))
], replace: ['person', 'dress1', 'dress2', 'dress3', 'dress4'], changes: [{ second: 1.5, how: '扇叶扫过' }], actions: [], unsure: ['是不是吊扇叶'] };
const personTemplate = '（在这里写你想要的人物：性别、年龄、长相、发型），单人全身正面照，穿简单的纯色贴身衣服，纯色背景。';
const clothesTemplate = '（在这里写你想要的衣服：颜色、款式、长短、材质），衣服平铺或无头人台展示，纯色背景，不出现人脸。';
function setup(seconds = 6) {
  graph.edges = [];
  graph.nodes = [{ id: 'source', type: 'card', selected: true, position: { x: 0, y: 0 }, data: newVideoCard('upload', 0,
    [{ type: 'upload', id: 'upload', media: 'video', seconds, hasAudio: true, width: 720, height: 1280 }]) }];
  const notify = vi.fn(), layout = vi.fn(), focus = vi.fn(), send = vi.fn(async (_id: string) => {}); let actions!: ReturnType<typeof useVideoRewrite>;
  let queued = false;
  const updates: Array<() => void> = [];
  const commit = (update: () => void) => { if (queued) updates.push(update); else update(); };
  function Harness() {
    actions = useVideoRewrite({ canvasId: 'c', setNodes: update => commit(() => { graph.nodes = update(graph.nodes); }),
      setEdges: update => commit(() => { graph.edges = update(graph.edges); }), takeNumber: cardCounter(), notify, layout, focus, send });
    return null;
  }
  renderToStaticMarkup(<Harness />);
  const cleanups = graph.effects.splice(0).map(effect => effect());
  return { actions, notify, layout, focus, send, unmount: () => { for (const cleanup of cleanups) cleanup?.(); },
    queue: () => { queued = true; }, flush: () => { queued = false; for (const update of updates.splice(0)) update(); } };
}
const sourceCard = () => graph.nodes.find(node => node.id === 'source')!;
const outputs = () => graph.nodes.filter(node => node.data.source === 'generate');
const waitAnalyze = () => new Promise<(value: Awaited<ReturnType<typeof api.analyzeVideo>>) => void>(done => {
  vi.mocked(api.analyzeVideo).mockImplementationOnce(() => new Promise(resolve => done(resolve)));
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.health).mockResolvedValue({ fake: true } as Awaited<ReturnType<typeof api.health>>);
  vi.mocked(api.submitDepthJob).mockResolvedValue({ id: 'depth-job' }); vi.mocked(api.submitMeshJob).mockResolvedValue({ id: 'mesh-job' });
  vi.mocked(api.extractAudio).mockResolvedValue({ id: 'audio-work', duration: 6 } as Awaited<ReturnType<typeof api.extractAudio>>);
  vi.mocked(api.analyzeVideo).mockResolvedValue({ ...meta, plan, yuan: 0.08, costUnknown: false });
  vi.mocked(api.extractFrame).mockResolvedValue({ id: 'frame', kind: 'image' });
});
it('开始改写前缺Key、TOS、所选动作参考或ffmpeg均返回输入框说明，零建卡零交单零花费', async () => {
  const ready = { filled: true, found: true };
  const complete = { ok: true, fake: false, keyReady: true, tosReady: true, ffmpegFound: true, ffprobeFound: true, todayYuan: 0, uncertainToday: 0,
    depth: { python: ready, modelDir: ready, extraPackages: { filled: false, found: false } },
    mesh: { ready: true, url: ready, directory: { filled: false, found: false } } };
  for (const [health, kind, expected] of [
    [{ ...complete, keyReady: false }, 'depth', 'ARK_API_KEY'],
    [{ ...complete, tosReady: false }, 'depth', 'TOS_ACCESS_KEY_ID'],
    [{ ...complete, depth: undefined }, 'depth', 'DEPTH_PYTHON'],
    [{ ...complete, mesh: { ...complete.mesh, ready: false } }, 'mesh', 'COMFYUI_DIR'],
    [{ ...complete, ffmpegFound: false }, 'depth', 'ffmpeg'],
    [{ ...complete, ffprobeFound: false }, 'depth', 'ffprobe'], [{ ...complete, ffprobeFound: undefined }, 'depth', 'ffprobe']
  ] as const) {
    vi.clearAllMocks(); vi.mocked(api.health).mockResolvedValue(health);
    const { actions, send, layout, focus } = setup(); const before = structuredClone(graph.nodes);
    expect(await actions.run('source', '换人物', true, kind)).toContain(expected);
    expect(graph.nodes).toEqual(before); expect(graph.edges).toHaveLength(0);
    for (const call of [api.analyzeVideo, api.extractFrame, api.submitDepthJob, api.submitMeshJob, send, layout, focus]) expect(call).not.toHaveBeenCalled();
    expect(actions.isPending('source')).toBe(false);
  }
});
it('体检等待时同一来源也锁住，体检失败不建卡且可重试', async () => {
  let rejectHealth!: (reason: Error) => void; vi.mocked(api.health).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectHealth = reject; }));
  const { actions } = setup(); const first = actions.run('source', '换人物'); await actions.run('source', '重复');
  expect(api.health).toHaveBeenCalledTimes(1); expect(graph.nodes).toHaveLength(1);
  rejectHealth(Error('体检读取失败')); expect(await first).toContain('体检读取失败');
  expect(actions.isPending('source')).toBe(false); expect(api.analyzeVideo).not.toHaveBeenCalled();
  await actions.run('source', '重试'); expect(api.analyzeVideo).toHaveBeenCalledTimes(1);
});
it('用户选白模时补白模并交白模单，复用同种卡、手动操作才重试，已有深度不顶替', async () => {
  const { actions } = setup();
  await actions.run('source', '换人物', true, 'depth');
  const depth = graph.nodes.find(node => node.data.source === 'depth')!;
  await actions.run('source', '换人物', true, 'mesh');
  const mesh = graph.nodes.find(node => node.data.source === 'mesh')!;
  expect(mesh).toBeDefined(); expect(mesh.id).not.toBe(depth.id);
  await vi.waitFor(() => expect(mesh.data.depthJobId).toBe('mesh-job'));
  expect(api.submitMeshJob).toHaveBeenCalledWith({ canvasId: 'c', cardId: mesh.id, source: { type: 'upload', id: 'upload' } });
  expect(api.submitDepthJob).toHaveBeenCalledTimes(1);
  await actions.run('source', '换人物', true, 'mesh');
  expect(graph.nodes.filter(node => node.data.source === 'mesh')).toHaveLength(1);
  expect(api.submitMeshJob).toHaveBeenCalledTimes(1);
  graph.nodes = graph.nodes.map(node => node.id === mesh.id ? { ...node, data: { ...node.data, depthJobId: undefined, startedAt: undefined, note: 'ComfyUI 失败' } } : node);
  await actions.run('source', '换人物', true, 'mesh');
  await vi.waitFor(() => expect(api.submitMeshJob).toHaveBeenCalledTimes(2));
  const video = outputs().filter(node => node.data.kind === 'video').at(-1)!;
  expect(video.data).toMatchObject({ rewriteMotionReference: 'mesh' });
  expect(videoRewriteMaterials(graph.nodes, graph.edges, video.id).at(-1)?.purpose).toBe('白模，参考人物动作、姿态、位置和机位');
});
it('打开入口不建卡、不发拆解；短视频给原时长原因；再次打开清掉上次失败说明', () => {
  const good = setup(); good.actions.start('source');
  expect(graph.nodes).toHaveLength(1); expect(graph.edges).toHaveLength(0); expect(api.analyzeVideo).not.toHaveBeenCalled();
  graph.nodes[0].data = { ...graph.nodes[0].data, kind: 'video', rewriteStatus: { status: 'failed', error: '断线', yuan: 0.02, costUnknown: false } } as CardNode['data'];
  good.actions.start('source');
  expect(sourceCard().data).not.toHaveProperty('rewriteStatus');
  const short = setup(2); short.actions.start('source');
  expect(short.notify).toHaveBeenCalledWith(expect.stringContaining('4 到 30 秒'));
  expect(graph.nodes).toHaveLength(1);
});
it('开始就出深度、第一帧和背景卡（背景马上自动出图），不建原声卡，拆解回来前不铺人物衣服卡；进度写在原视频卡上', async () => {
  const { actions, layout, send } = setup();
  const resolving = waitAnalyze();
  const task = actions.run('source', '换衣服'); await Promise.resolve(); // 建卡要先等health预检完成。
  expect(graph.nodes.map(node => node.data.kind)).toEqual(['video', 'video', 'video']);
  const early = outputs().find(node => node.data.kind === 'video')!;
  expect(early.data).toMatchObject({ rewriteStatus: { status: 'pending' }, rewriteBusy: 'analyzing' });
  expect(actions.restore([early])[0]).toBe(early);
  expect(sourceCard().data).toMatchObject({ rewriteBusy: 'analyzing', rewriteStatus: { status: 'pending' } });
  expect(layout).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ ids: [graph.nodes[1].id], origin: { x: 380, y: 0 } }));
  await vi.waitFor(() => expect(api.analyzeVideo).toHaveBeenCalledTimes(1));
  expect(api.extractFrame).toHaveBeenCalledWith({ source: { type: 'upload', id: 'upload' }, second: 0 });
  expect(vi.mocked(api.extractFrame).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.analyzeVideo).mock.invocationCallOrder[0]);
  const frame = graph.nodes.find(node => node.data.kind === 'image' && node.data.source === 'upload')!;
  const background = outputs().find(node => node.data.title === '背景')!;
  expect(frame.data).toMatchObject({ title: '原视频第一帧', results: [{ type: 'upload', id: 'frame' }] });
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: frame.id, target: background.id }));
  const media = [graph.nodes[1].id, frame.id];
  expect(layout).toHaveBeenLastCalledWith(expect.any(String), { ids: media, movableIds: media, origin: { x: 380, y: 0 } });
  expect(new Set(layout.mock.calls.map(call => call[0])).size).toBe(1);
  await vi.waitFor(() => expect(send).toHaveBeenCalledWith(background.id));
  expect(outputs().map(node => node.id)).toEqual([early.id, background.id]);
  (await resolving)({ ...meta, plan, yuan: 0, costUnknown: false }); await task;
  expect(outputs()).toHaveLength(7); expect(send).toHaveBeenCalledTimes(1);
  expect(outputs().find(node => node.data.kind === 'video')!.id).toBe(early.id);
  expect(outputs().find(node => node.id === early.id)!.data).not.toHaveProperty('rewriteBusy');
  expect(actions.restore([early])[0].data.rewriteStatus).toEqual({ status: 'interrupted' });
});
it('第一步完成：图片卡填模板、视频词留空并保存改写快照，只选中新视频卡并挪画面，原卡进度清掉', async () => {
  const { actions, notify, focus } = setup(); await actions.run('source', '换人换衣服');
  const cards = outputs(); expect(cards).toHaveLength(7);
  expect(cards.filter(node => node.data.kind === 'image' && node.data.rewriteItem).map(node => node.data.prompt)).toEqual([personTemplate, ...Array(4).fill(clothesTemplate)]);
  const video = cards.find(node => node.data.kind === 'video')!;
  expect(video.data).toMatchObject({ prompt: '', rewriteChangeSeconds: [1.5, 3, 4.5], rewritePlan: plan, rewriteUserText: '换人换衣服' });
  expect(video.data.kind === 'video' && video.data.rewritePlan).not.toBe(plan);
  expect(api.writeVideoPrompt).not.toHaveBeenCalled();
  expect(graph.edges.filter(edge => edge.target === video.id).map(edge => graph.nodes.find(node => node.id === edge.source)!.data.kind)).toEqual(['image', 'image', 'image', 'image', 'image', 'image', 'video']);
  expect(video.data).toMatchObject({ video: { audio: false }, rewriteSource: { hasAudio: true } });
  expect(api.extractAudio).not.toHaveBeenCalled();
  expect(graph.nodes.filter(node => node.selected).map(node => node.id)).toEqual([video.id]);
  expect(focus).toHaveBeenCalledWith(video.id);
  for (const field of ['rewriteBusy', 'rewriteStatus']) expect(sourceCard().data).not.toHaveProperty(field);
  expect(sourceCard().data).not.toHaveProperty('rewritePlan');
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 6 张图后，在视频卡点「生成提示词」；已花 ¥0.08；背景图另算约 ¥0.12');
});
it('铺好的图片卡排在背景卡下面，按顺序交给实测排版排紧，背景卡不挪', async () => {
  const { actions, layout } = setup(); await actions.run('source', '换人换衣服');
  const [background, ...items] = outputs().filter(node => node.data.kind === 'image').map(node => node.id);
  expect(outputs().find(node => node.id === background)?.data.title).toBe('背景');
  expect(layout).toHaveBeenCalledWith(expect.any(String), { ids: [background, ...items], movableIds: items, origin: { x: 760, y: 0 } });
});
it('素材表背景排 @图片1，背景卡第一个连进视频卡；铺好的人物衣服卡尺寸跟视频比例', async () => {
  const { actions } = setup(); await actions.run('source', '换人换衣服');
  const video = outputs().find(node => node.data.kind === 'video')!;
  const materials = videoRewriteMaterials(graph.nodes, graph.edges, video.id);
  expect(materials.map(item => item.tag)).toEqual(['@图片1', '@图片2', '@图片3', '@图片4', '@图片5', '@图片6', '@视频1']);
  expect(materials[0].purpose).toMatch(/^背景/);
  const background = outputs().find(node => node.data.title === '背景')!;
  expect(graph.edges.filter(edge => edge.target === video.id)[0].source).toBe(background.id);
  for (const node of outputs().filter(node => node.data.kind === 'image' && node.data.rewriteItem)) expect(node.data.kind === 'image' && node.data.gen.aspect).toBe('9:16');
});
it('不勾「背景和原片一致」：第一帧照截连着背景卡，背景卡不自动出图，完成提示把背景算进要补的图', async () => {
  const { actions, send, notify } = setup(); await actions.run('source', '换人换衣服', false);
  expect(api.extractFrame).toHaveBeenCalledTimes(1);
  const frame = graph.nodes.find(node => node.data.kind === 'image' && node.data.source === 'upload')!;
  const background = outputs().find(node => node.data.title === '背景')!;
  expect(background.data).toMatchObject({ rewriteNewScene: true, prompt: REWRITE_NEW_SCENE_PROMPT, results: [] });
  expect(graph.edges).toContainEqual(expect.objectContaining({ source: frame.id, target: background.id }));
  expect(send).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 6 张图后，在视频卡点「生成提示词」；已花 ¥0.08；背景卡等你上传或生成');
});
it('截第一帧失败就不拆解、不花钱，原卡写原话和 ¥0', async () => {
  vi.mocked(api.extractFrame).mockRejectedValue(Error('找不到执行程序'));
  const { actions, notify } = setup(); await actions.run('source', '换人');
  expect(api.analyzeVideo).not.toHaveBeenCalled(); expect(outputs()).toHaveLength(1);
  expect(outputs()[0].data).toMatchObject({ kind: 'video', rewriteStatus: { status: 'failed', error: '找不到执行程序', yuan: 0, costUnknown: false } });
  expect(sourceCard().data).toMatchObject({ rewriteStatus: { status: 'failed', error: '找不到执行程序', yuan: 0, costUnknown: false } });
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('找不到执行程序'));
});
it('背景卡自动生成失败把原话写在背景卡上，其余照常', async () => {
  const { actions, send } = setup(); send.mockRejectedValueOnce(Error('ARK_API_KEY 还没填'));
  await actions.run('source', '换人换衣服');
  const background = () => outputs().find(node => node.data.title === '背景')!;
  await vi.waitFor(() => expect(background().data.note).toBe('ARK_API_KEY 还没填'));
  expect(outputs().filter(node => node.data.kind === 'video')).toHaveLength(1);
});
it('两轮拆解中途失败不铺替换卡，原视频卡写原话和已花，额外费用标未知，不重发', async () => {
  const { actions, notify, focus } = setup();
  vi.mocked(api.analyzeVideo).mockRejectedValue(Object.assign(Error('第二轮断线'), { yuan: 0.04, costUnknown: true }));
  await actions.run('source', '换衣服');
  expect(outputs().filter(node => node.data.kind === 'image').map(node => node.data.title)).toEqual(['背景']); expect(focus).not.toHaveBeenCalled();
  const early = outputs().find(node => node.data.kind === 'video')!;
  expect(early.data.rewriteStatus).toEqual(sourceCard().data.rewriteStatus);
  expect(sourceCard().data).toMatchObject({ rewriteStatus: { status: 'failed', error: '第二轮断线', yuan: 0.04, costUnknown: true } });
  expect(sourceCard().data).not.toHaveProperty('rewriteBusy');
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('第二轮断线'));
  expect(api.analyzeVideo).toHaveBeenCalledTimes(1); expect(api.writeVideoPrompt).not.toHaveBeenCalled();
  const resolving = waitAnalyze(), retry = actions.run('source', '换衣服');
  expect(outputs().filter(node => node.data.kind === 'video').map(node => node.id)).toEqual([early.id]);
  (await resolving)({ ...meta, plan, yuan: 0, costUnknown: false }); await retry;
  expect(outputs().filter(node => node.data.kind === 'video').map(node => node.id)).toEqual([early.id]);
});
it('拆解前就被拒（没花钱）时原卡写清零花费，不写词', async () => {
  const { actions } = setup();
  vi.mocked(api.analyzeVideo).mockRejectedValue(Object.assign(Error('缺少 Key，这次没发出去，没花钱。'), { yuan: 0, costUnknown: false }));
  await actions.run('source', '换');
  expect(api.writeVideoPrompt).not.toHaveBeenCalled(); expect(outputs().filter(node => node.data.kind === 'image').map(node => node.data.title)).toEqual(['背景']);
  expect(sourceCard().data).toMatchObject({ rewriteStatus: { status: 'failed', yuan: 0, costUnknown: false } });
});
it('同来源并发只跑一次，做完再开始是全新一套且媒体复用，原话记在页面期间', async () => {
  const { actions } = setup(); const resolving = waitAnalyze();
  const first = actions.run('source', '我的衣服');
  await actions.run('source', '不该重复');
  await vi.waitFor(() => expect(api.analyzeVideo).toHaveBeenCalledTimes(1));
  expect(api.analyzeVideo).toHaveBeenCalledTimes(1);
  (await resolving)({ ...meta, plan, yuan: 0, costUnknown: false }); await first;
  expect(actions.textFor('source')).toBe('我的衣服');
  await actions.run('source', '我的衣服');
  expect(outputs()).toHaveLength(14);
  expect(api.submitDepthJob).toHaveBeenCalledTimes(1); expect(api.extractAudio).not.toHaveBeenCalled();
});
it('撤销恢复回来的「正在改写」：这页还在跑就不动，跑完再恢复就是上次没做完；跑的时候删了原视频照样铺卡', async () => {
  const { actions } = setup(); const resolving = waitAnalyze();
  const task = actions.run('source', '换');
  await vi.waitFor(() => expect(api.analyzeVideo).toHaveBeenCalledTimes(1));
  const snapshot = sourceCard();
  expect(actions.restore([snapshot])[0]).toBe(snapshot);
  graph.nodes = graph.nodes.filter(node => node.id !== 'source');
  (await resolving)({ ...meta, plan, yuan: 0, costUnknown: false }); await task;
  expect(outputs()).toHaveLength(7); expect(graph.nodes.some(node => node.id === 'source')).toBe(false);
  expect(actions.restore([snapshot])[0].data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
});
it('页面期间草稿按来源结果记住，来源翻页独立且切换画布回来不丢', () => {
  const first = setup(); first.actions.remember('source', '来源A要换衣服');
  expect(first.actions.textFor('source')).toBe('来源A要换衣服');
  const source = graph.nodes[0];
  source.data.results.push({ type: 'upload', id: 'upload-b', media: 'video', seconds: 6 }); source.data.page = 1;
  expect(first.actions.textFor('source')).toBe('');
  first.actions.remember('source', '来源B要换背景'); source.data.page = 0;
  expect(first.actions.textFor('source')).toBe('来源A要换衣服');
  const remounted = setup(); expect(remounted.actions.textFor('source')).toBe('来源A要换衣服');
});
it('同素材的另一张卡或切画布后重建的入口也不能重复收费', async () => {
  const first = setup(); const resolving = waitAnalyze();
  const task = first.actions.run('source', '换衣服');
  graph.nodes.push({ ...graph.nodes[0], id: 'same-source' });
  await first.actions.run('same-source', '重复');
  await vi.waitFor(() => expect(api.analyzeVideo).toHaveBeenCalledTimes(1));
  expect(api.analyzeVideo).toHaveBeenCalledTimes(1);
  const remounted = setup();
  expect(remounted.actions.isPending('source')).toBe(true);
  await remounted.actions.run('source', '仍然不能重复');
  expect(api.analyzeVideo).toHaveBeenCalledTimes(1);
  (await resolving)({ ...meta, plan, yuan: 0, costUnknown: false }); await task;
  expect(remounted.actions.isPending('source')).toBe(false);
});
it('切画布卸载时已发拆解继续记账，但不得再花第三轮费用丢掉产物', async () => {
  const { actions, unmount } = setup(); const resolving = waitAnalyze();
  const task = actions.run('source', '换衣服');
  await vi.waitFor(() => expect(api.analyzeVideo).toHaveBeenCalledTimes(1));
  unmount(); (await resolving)({ ...meta, plan, yuan: 0.08, costUnknown: false }); await task;
  expect(api.analyzeVideo).toHaveBeenCalledTimes(1); expect(api.writeVideoPrompt).not.toHaveBeenCalled();
  expect(outputs().filter(node => node.data.kind === 'image').map(node => node.data.title)).toEqual(['背景']);
  expect(outputs().filter(node => node.data.kind === 'video')).toHaveLength(1); expect(actions.isPending('source')).toBe(false);
});
it('旧来源没有音轨标记时，拆解接口的真实元数据写进新视频卡的来源快照（配回原声靠它），也不建原声卡', async () => {
  const { actions } = setup(); delete graph.nodes[0].data.results[0].hasAudio;
  await actions.run('source', '换衣服');
  expect(graph.nodes.some(node => node.data.kind === 'audio')).toBe(false); expect(api.extractAudio).not.toHaveBeenCalled();
  expect(outputs().find(node => node.data.kind === 'video')!.data).toMatchObject({ rewriteSource: { hasAudio: true }, video: { audio: false } });
});
it('背景已有结果时只提示补人物衣服五张，模板不含原描述，原描述独立留在快照', async () => {
  const { actions, send, notify } = setup();
  send.mockImplementationOnce(async id => {
    const background = graph.nodes.find(node => node.id === id)!;
    background.data.results = [{ type: 'work', id: 'background-done' }];
  });
  await actions.run('source', '保留原话');
  expect(notify).toHaveBeenCalledWith('图片卡已铺好：补完 5 张图后，在视频卡点「生成提示词」；已花 ¥0.08；背景图另算约 ¥0.12');
  for (const node of outputs()) {
    if (node.data.kind !== 'image' || !node.data.rewriteItem) continue;
    const itemId = node.data.rewriteItemId;
    expect(node.data.rewriteItem.desc).toBe(plan.items.find(item => item.id === itemId)?.desc);
    expect(node.data.prompt).not.toContain(node.data.rewriteItem.desc);
  }
});
