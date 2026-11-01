import { describe, expect, it } from 'vitest';
import { newVideoCard, newAudioCard, cardCounter } from './cards';
import { fromDoc, toDoc, readCard } from './canvasDoc';
import { startVideoRewrite, prepareRewriteCards, rewriteMaterials, replacementItems, videoRewriteMaterials, rewriteChangeSeconds,
  addRewriteBackground, REWRITE_BACKGROUND_PROMPT, REWRITE_BACKGROUND_PURPOSE, REWRITE_NEW_SCENE_PROMPT, REWRITE_NEW_SCENE_PURPOSE, rewriteStartProblem } from './videoRewrite';
import type { CardNode, CardData, AssetRef } from '@/types';
import type { RewritePlan } from '@/videoRewriteTypes';

const asset: AssetRef = { type: 'upload', id: 'source', media: 'video', seconds: 15.04, width: 480, height: 854, hasAudio: true };
const node = (id: string, data: CardData, x = 0, y = 0): CardNode => ({ id, type: 'card', data, position: { x, y } });
const plan: RewritePlan = { summary: '换装', items: [
  { id: 'late', kind: '衣服', desc: '晚装', from: 5, to: 15, frame: 6 },
  { id: 'scene', kind: '场景', desc: '公园', from: 0, to: 15, frame: 0 },
  { id: 'person', kind: '人物', desc: '人物', from: 0, to: 15, frame: 1 },
  { id: 'early', kind: '衣服', desc: '日装', from: 0, to: 5, frame: 1 }
], replace: ['late', 'early', 'person'], changes: [{ second: 5.5, how: '扇叶扫过换装' }], actions: [], unsure: [] };
const source = node('s', newVideoCard('upload', 1, [asset]));
let serial = 0;
const makeId = () => `new${++serial}`;
const start = (nodes = [source], edges: Array<{ id: string; source: string; target: string }> = []) =>
  startVideoRewrite({ source, nodes, edges, takeNumber: cardCounter(), makeId, userText: '换人换衣' });

it('改写预检一次列出全部缺项；真模式齐全才放行，假模式不挡，白模和深度互不要求对方', () => {
  const ready = { filled: true, found: true };
  const health = { ok: true, fake: false, keyReady: false, tosReady: false, todayYuan: 0, uncertainToday: 0 };
  const missing = rewriteStartProblem(health, 'depth');
  for (const name of ['ARK_API_KEY', 'TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY', 'TOS_BUCKET', 'DEPTH_PYTHON', 'DEPTH_MODEL_DIR', 'ffmpeg', 'ffprobe', '.env.local', '没花钱']) expect(missing).toContain(name);
  expect(rewriteStartProblem({ ...health, fake: true }, 'mesh')).toBeNull();
  const complete = { ...health, keyReady: true, tosReady: true, ffmpegFound: true, ffprobeFound: true };
  expect(rewriteStartProblem({ ...complete, depth: { python: ready, modelDir: ready, extraPackages: { filled: false, found: false } } }, 'depth')).toBeNull();
  expect(rewriteStartProblem({ ...complete, mesh: { ready: true, url: ready, directory: { filled: false, found: false } } }, 'mesh')).toBeNull();
  expect(rewriteStartProblem(complete, 'mesh')).toContain('打开 ComfyUI');
  for (const ffprobeFound of [false, undefined]) {
    expect(rewriteStartProblem({ ...complete, ffprobeFound, depth: { python: ready, modelDir: ready, extraPackages: ready } }, 'depth')).toContain('ffprobe');
    expect(rewriteStartProblem({ ...complete, ffprobeFound, mesh: { ready: true, url: ready, directory: ready } }, 'mesh')).toBeNull();
  }
});

describe('一键改写普通卡', () => {
  it('开始只补深度和最终视频（10-30 起不建原声卡，成片出好后配回原声），不建任何图片卡，运行信息不保存改写单', () => {
    const graph = start();
    expect(graph.nodes.map(n => n.data.kind)).toEqual(['video', 'video', 'video']);
    expect(graph.state).toMatchObject({ batchId: graph.batchId, sourceId: 's', source: asset, userText: '换人换衣', hasAudio: true });
    expect(toDoc({ id: 'c', name: 'n' }, graph.nodes, graph.edges).nodes.every(n => !Object.hasOwn(n.data, 'rewrite'))).toBe(true);
  });
  it('复用同素材的深度且保持原卡位置，旧画布已有的原声卡不动也不连，每次新批次', () => {
    const depth = node('depth', { ...newVideoCard('depth', 2), mediaSource: asset }, 900, 900);
    const audio = node('audio', { ...newAudioCard('extracted', 3), mediaSource: asset }, 900, 1500);
    const graph = start([source, depth, audio]);
    expect(graph.depthId).toBe('depth');
    expect(graph.nodes.find(n => n.id === 'depth')?.position).toEqual(depth.position);
    expect(graph.nodes.find(n => n.id === 'audio')).toMatchObject({ data: audio.data, position: audio.position });
    expect(graph.edges.some(edge => edge.source === 'audio' || edge.target === 'audio')).toBe(false);
    const again = start(graph.nodes, graph.edges);
    expect(again.batchId).not.toBe(graph.batchId);
    expect(again.nodes).toHaveLength(4);
  });
  it('短片先拒绝，长片同样拒绝', () => {
    for (const seconds of [3.99, 30.01]) expect(() => startVideoRewrite({ source: node('bad', newVideoCard('upload', 1, [{ ...asset, seconds }])), nodes: [], edges: [], takeNumber: cardCounter(), makeId, userText: '换人' })).toThrow('4');
  });
  it('两轮分析后能生成完整素材表并铺第三列图片和第四列视频，顺序固定，视频卡存改写快照、默认关生成音频', () => {
    const graph = start(); const state = { ...graph.state, plan };
    expect(replacementItems(plan).map(item => item.id)).toEqual(['person', 'early', 'late']);
    expect(rewriteMaterials(state).map(item => item.tag)).toEqual(['@图片1', '@图片2', '@图片3', '@视频1']);
    const next = prepareRewriteCards({ state, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
    const video = next.nodes.find(n => n.id === next.videoId)!;
    expect(video.position.x).toBe(1140);
    expect(video.data).toMatchObject({ kind: 'video', rewriteId: graph.batchId, rewriteSource: asset, rewriteSourceId: 's', rewriteChangeSeconds: [5], rewritePlan: plan, rewriteUserText: '换人换衣', prompt: '',
      video: { model: 'doubao-seedance-2-5-260628', mode: 'reference', ratio: '9:16', resolution: '480p', duration: 15, audio: false } });
    expect(next.nodes.find(n => n.id === next.imageIds.person)?.data).toMatchObject({ kind: 'image', rewriteItemId: 'person', rewriteItem: plan.items[2] });
    expect(next.imageIds).not.toHaveProperty('scene');
    expect(next.edges.filter(e => e.target === video.id).map(e => e.source)).toEqual([...Object.values(next.imageIds), graph.depthId]);
    expect(videoRewriteMaterials(next.nodes, next.edges, next.videoId)).toEqual(rewriteMaterials(state));
    expect(videoRewriteMaterials(next.nodes, [...next.edges].reverse(), next.videoId).filter(value => value.itemId).map(value => [value.itemId, value.tag]))
      .toEqual([['late', '@图片1'], ['early', '@图片2'], ['person', '@图片3']]);
  });
  it('第一帧背景：第 2 列放第一帧卡、第 3 列最上面放背景卡并连线；背景排 @图片1、第一个连视频；人物衣服卡在背景下面、尺寸跟视频比例', () => {
    const graph = start(); const frame: AssetRef = { type: 'upload', id: 'frame' };
    const added = addRewriteBackground({ state: graph.state, frame, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
    const frameCard = added.nodes.find(n => n.id === added.frameId)!, back = added.nodes.find(n => n.id === added.backgroundId)!;
    expect(frameCard.data).toMatchObject({ kind: 'image', source: 'upload', number: 0, title: '原视频第一帧', results: [frame] });
    expect(frameCard.position.x).toBe(380); expect(frameCard.position.y).toBeGreaterThan(added.nodes.find(n => n.id === graph.depthId)!.position.y);
    expect(back.data).toMatchObject({ kind: 'image', source: 'generate', title: '背景', rewriteId: graph.batchId, prompt: REWRITE_BACKGROUND_PROMPT, gen: { sizeFrom: 1 } });
    expect(back.data).not.toHaveProperty('rewriteItem');
    expect(back.position).toEqual({ x: 760, y: 0 });
    expect(added.edges).toEqual([...graph.edges, { id: `link:${frameCard.id}>${back.id}`, source: frameCard.id, target: back.id }]);
    expect(added.state).toMatchObject({ frameId: frameCard.id, backgroundId: back.id });
    const state = { ...added.state, plan };
    const materials = rewriteMaterials(state);
    expect(materials.map(item => item.tag)).toEqual(['@图片1', '@图片2', '@图片3', '@图片4', '@视频1']);
    expect(materials[0]).toEqual({ tag: '@图片1', purpose: REWRITE_BACKGROUND_PURPOSE });
    expect(REWRITE_BACKGROUND_PURPOSE.startsWith('背景')).toBe(true);
    const next = prepareRewriteCards({ state, nodes: added.nodes, edges: added.edges, takeNumber: cardCounter(), makeId });
    const items = Object.values(next.imageIds);
    expect(next.edges.filter(e => e.target === next.videoId).map(e => e.source)).toEqual([back.id, ...items, graph.depthId]);
    expect(next.imageColumn).toEqual({ ids: [back.id, ...items], movableIds: items, origin: { x: 760, y: 0 } });
    for (const id of items) {
      const card = next.nodes.find(n => n.id === id)!;
      expect(card.position.y).toBeGreaterThan(back.position.y);
      expect(card.data.kind === 'image' && card.data.gen.aspect).toBe('9:16');
    }
    expect(videoRewriteMaterials(next.nodes, next.edges, next.videoId)).toEqual(materials);
    const reloaded = fromDoc(toDoc({ id: 'c', name: 'n' }, next.nodes, next.edges));
    expect(videoRewriteMaterials(reloaded.nodes, reloaded.edges, next.videoId)).toEqual(materials);
  });
  it('不勾「背景和原片一致」：第一帧照截只当构图参考，背景卡填新场景模板、标记新场景、尺寸跟原片；素材表写新场景，存档读回不丢', () => {
    const graph = start(); const frame: AssetRef = { type: 'upload', id: 'frame' };
    const args = { state: graph.state, frame, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId };
    const added = addRewriteBackground({ ...args, newScene: true });
    const back = added.nodes.find(n => n.id === added.backgroundId)!;
    expect(back.data).toMatchObject({ kind: 'image', source: 'generate', title: '背景', prompt: REWRITE_NEW_SCENE_PROMPT, rewriteNewScene: true, gen: { sizeFrom: 1, aspect: '9:16' } });
    expect(added.edges.at(-1)).toMatchObject({ source: added.frameId, target: back.id });
    const state = { ...added.state, plan };
    expect(state.newScene).toBe(true);
    expect(rewriteMaterials(state)[0]).toEqual({ tag: '@图片1', purpose: REWRITE_NEW_SCENE_PURPOSE });
    expect(REWRITE_NEW_SCENE_PURPOSE.startsWith('背景')).toBe(true);
    const next = prepareRewriteCards({ state, nodes: added.nodes, edges: added.edges, takeNumber: cardCounter(), makeId });
    expect(videoRewriteMaterials(next.nodes, next.edges, next.videoId)).toEqual(rewriteMaterials(state));
    const reloaded = fromDoc(toDoc({ id: 'c', name: 'n' }, next.nodes, next.edges));
    expect(reloaded.nodes.find(n => n.id === back.id)!.data).toMatchObject({ rewriteNewScene: true, prompt: REWRITE_NEW_SCENE_PROMPT });
    expect(videoRewriteMaterials(reloaded.nodes, reloaded.edges, next.videoId)).toEqual(rewriteMaterials(state));
    const kept = addRewriteBackground(args), keptBack = kept.nodes.find(n => n.id === kept.backgroundId)!;
    expect(keptBack.data).toMatchObject({ prompt: REWRITE_BACKGROUND_PROMPT, gen: { sizeFrom: 1, aspect: '9:16' } });
    expect(keptBack.data).not.toHaveProperty('rewriteNewScene'); expect(kept.state.newScene).toBeUndefined();
  });
  it('来源删除后仍能从快照铺卡；超八个参考先拒绝不铺卡', () => {
    const graph = start(); const state = { ...graph.state, plan };
    const remaining = graph.nodes.filter(n => n.id !== source.id);
    const next = prepareRewriteCards({ state, nodes: remaining, edges: [], takeNumber: cardCounter(), makeId });
    expect(next.nodes.find(n => n.id === next.videoId)?.data).toMatchObject({ rewriteSource: asset });
    const many = { ...plan, items: Array.from({ length: 8 }, (_, i) => ({ ...plan.items[2], id: `p${i}` })), replace: Array.from({ length: 8 }, (_, i) => `p${i}`) };
    expect(() => prepareRewriteCards({ state: { ...state, plan: many }, nodes: graph.nodes, edges: [], takeNumber: cardCounter(), makeId })).toThrow('图和视频加起来最多 8 个参考');
  });
  it('衣服标题最多一位小数，单项描述和证据保持原值', () => {
    const graph = start(); const item = { ...plan.items[0], from: 3.58804, to: 4.983389 };
    const next = prepareRewriteCards({ state: { ...graph.state, plan: { ...plan, items: [item], replace: [item.id] } }, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
    expect(next.nodes.find(n => n.id === next.imageIds.late)?.data).toMatchObject({ title: '衣服 1（3.6-5 秒）', rewriteItem: item });
    expect(rewriteMaterials({ ...graph.state, plan: { ...plan, items: [item], replace: [item.id] } })[0].purpose).toBe('衣服 1（3.6-5 秒穿）');
    expect(videoRewriteMaterials(next.nodes, next.edges, next.videoId)[0].purpose).toBe('衣服 1（3.6-5 秒穿）');
  });
  it('生成卡保存独立改写单及单项原描述快照，后续修改分析结果不污染卡片', () => {
    const graph = start(); const original = structuredClone(plan);
    original.items[2].desc = '黑色卷发戴眼镜的年轻男子';
    const snapshot = structuredClone(original);
    const next = prepareRewriteCards({ state: { ...graph.state, plan: original }, nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
    const video = next.nodes.find(n => n.id === next.videoId)!;
    const person = next.nodes.find(n => n.id === next.imageIds.person)!;
    original.items[2].desc = '后来改的描述'; original.replace.length = 0;
    expect(video.data).toMatchObject({ rewritePlan: snapshot, rewriteUserText: '换人换衣' });
    expect(person.data).toMatchObject({ rewriteItem: snapshot.items[2] });
    expect(person.data.prompt).not.toContain(snapshot.items[2].desc);
  });
  it('免费检查只带时长以内的变化秒数', () => {
    const video = { ...newVideoCard('generate', 2), rewriteChangeSeconds: [5.5, 9, 12] };
    video.video.duration = 10;
    expect(rewriteChangeSeconds(video)).toEqual([5.5, 9]);
    expect(rewriteChangeSeconds(newVideoCard('generate', 3))).toEqual([]);
  });
  it('10-29 变化秒数只取换装点：有拆解单就按衣服时段算，0 秒、1 秒这类动作变化不算；旧卡没单子才用存的秒数', () => {
    const video = { ...newVideoCard('generate', 2), rewriteChangeSeconds: [0, 1, 5.5],
      rewritePlan: { ...plan, changes: [{ second: 0, how: '走入' }, { second: 1, how: '躺下' }, { second: 5.5, how: '换装' }] } };
    video.video.duration = 10;
    expect(rewriteChangeSeconds(video)).toEqual([5]);
  });
  it('10-29 换装点优先用衣服交界处的 changes 秒数（真跑：衣服2写 6 秒开始、换装写 5.8）', () => {
    const items = [{ id: 'a', kind: '衣服' as const, desc: '日装', from: 0, to: 5.8, frame: 1 }, { id: 'b', kind: '衣服' as const, desc: '晚装', from: 6, to: 15, frame: 7 }];
    const video = { ...newVideoCard('generate', 2), rewritePlan: { ...plan, items, changes: [{ second: 4.8, how: '吊扇开始转' }, { second: 5.8, how: '换装' }] } };
    video.video.duration = 15;
    expect(rewriteChangeSeconds(video)).toEqual([5.8]);
  });
});

describe('存档和中断恢复', () => {
  it('原视频卡只存「正在改写」标记，不存阶段；打开时变成上次没做完，失败说明原样保留', () => {
    const running: CardNode = { ...source, data: { ...source.data, kind: 'video', rewriteStatus: { status: 'pending' },
      rewriteBusy: 'analyzing' } as CardData };
    const doc = toDoc({ id: 'c', name: 'n' }, [running], []);
    expect(doc.nodes[0].data).not.toHaveProperty('rewriteBusy');
    expect(doc.nodes[0].data).toMatchObject({ rewriteStatus: { status: 'pending' } });
    expect(fromDoc(doc).nodes[0].data).toMatchObject({ rewriteStatus: { status: 'interrupted' } });
    const failed = { ...source.data, rewriteStatus: { status: 'failed', error: '第二轮断线', yuan: 0.05, costUnknown: true } };
    expect(readCard(failed)).toMatchObject({ rewriteStatus: failed.rewriteStatus });
    expect(readCard(source.data)).not.toHaveProperty('rewriteStatus');
  });
  it('新视频卡的变化秒数和改写快照随画布保存，原视频不存改写单', () => {
    const graph = start();
    const savedPlan = { ...plan, changes: [{ second: 5.5, how: '扇叶' }, { second: 9, how: '扇叶' }] };
    const result = prepareRewriteCards({ state: { ...graph.state, plan: savedPlan },
      nodes: graph.nodes, edges: graph.edges, takeNumber: cardCounter(), makeId });
    const video = result.nodes.find(n => n.id === result.videoId)!;
    const saved = toDoc({ id: 'c', name: 'n' }, [video], []);
    expect(saved.nodes[0].data).toMatchObject({ rewritePlan: savedPlan, rewriteUserText: '换人换衣' });
    expect(fromDoc(saved).nodes[0].data).toMatchObject({ rewriteChangeSeconds: [5], rewritePlan: savedPlan, rewriteUserText: '换人换衣' });
    expect(toDoc({ id: 'c', name: 'n' }, [source], []).nodes[0].data).not.toHaveProperty('rewritePlan');
  });
});
