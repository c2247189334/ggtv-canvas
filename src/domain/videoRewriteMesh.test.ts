import { expect, it } from 'vitest';
import { cardCounter, newVideoCard } from './cards';
import { startVideoRewrite, prepareRewriteCards, rewriteMaterials, videoRewriteMaterials, REWRITE_MESH_PURPOSE } from './videoRewrite';
import { fromDoc, toDoc, readCard } from './canvasDoc';
import { retryRewriteMedia } from './rewriteMedia';
import { readRewriteMotionReference } from './videoRewriteDoc';
import type { CardNode } from '@/types';
import type { RewritePlan } from '@/videoRewriteTypes';

const asset = { type: 'upload' as const, id: 'source-video', media: 'video' as const, seconds: 6, width: 720, height: 1280 };
const source: CardNode = { id: 'source', type: 'card', position: { x: 0, y: 0 }, data: newVideoCard('upload', 1, [asset]) };
const plan: RewritePlan = { summary: '换人物', items: [{ id: 'p', kind: '人物', desc: '人物', from: 0, to: 6, frame: 0 }], replace: ['p'], changes: [], actions: [], unsure: [] };
const start = (motionReference: 'mesh' | 'depth', nodes: CardNode[] = [source]) => startVideoRewrite({ source, nodes, edges: [],
  userText: '人物换成我的', motionReference, takeNumber: cardCounter(), makeId: () => crypto.randomUUID() });

it('按种类复用同来源卡，白模和深度互不顶替，保留已有卡位置和来源线', () => {
  const depth = start('depth');
  const mesh = start('mesh', depth.nodes);
  const meshCard = mesh.nodes.find(node => node.id === mesh.depthId)!;
  expect(mesh.depthId).not.toBe(depth.depthId);
  expect(meshCard.data).toMatchObject({ source: 'mesh', mediaSource: asset });
  expect(mesh.edges).toContainEqual(expect.objectContaining({ source: source.id, target: meshCard.id }));
  expect(meshCard.position.x).toBe(380);
  meshCard.position = { x: 888, y: 999 };
  const again = start('mesh', mesh.nodes);
  expect(again.depthId).toBe(meshCard.id);
  expect(again.nodes.find(node => node.id === meshCard.id)?.position).toEqual({ x: 888, y: 999 });
  expect(start('depth', mesh.nodes).depthId).toBe(depth.depthId);
  const different = mesh.nodes.map(node => node.id === meshCard.id ? { ...node, data: { ...node.data, mediaSource: { ...asset, id: 'other' } } } : node);
  expect(start('mesh', different).depthId).not.toBe(meshCard.id);
});

it('白模素材用途、最终连线和种类随存档保留；旧存档没有种类按深度读', () => {
  const graph = start('mesh'), state = { ...graph.state, plan };
  const prepared = prepareRewriteCards({ ...graph, state, takeNumber: cardCounter(), makeId: () => crypto.randomUUID() });
  expect(REWRITE_MESH_PURPOSE).toBe('白模，参考人物动作、姿态、位置和机位');
  expect(rewriteMaterials(state).at(-1)?.purpose).toBe(REWRITE_MESH_PURPOSE);
  expect(videoRewriteMaterials(prepared.nodes, prepared.edges, prepared.videoId)).toEqual(rewriteMaterials(state));
  expect(prepared.edges.filter(edge => edge.target === prepared.videoId).at(-1)?.source).toBe(graph.depthId);
  const loaded = fromDoc(toDoc({ id: 'canvas', name: '测试' }, prepared.nodes, prepared.edges));
  expect(loaded.nodes.find(node => node.id === graph.depthId)?.data.source).toBe('mesh');
  expect(loaded.nodes.find(node => node.id === prepared.videoId)?.data).toMatchObject({ rewriteMotionReference: 'mesh' });
  expect(videoRewriteMaterials(loaded.nodes, loaded.edges, prepared.videoId)).toEqual(rewriteMaterials(state));
  expect(readRewriteMotionReference(undefined)).toBe('depth');
  expect(readRewriteMotionReference('bad')).toBe('depth');
  expect(readCard({ ...newVideoCard('generate', 2), rewriteId: 'old' })).toMatchObject({ rewriteMotionReference: 'depth' });
});

it('白模参考数量也计入八个上限；结果、任务和运行中不能重试，仅明确失败可由用户重试', () => {
  const graph = start('mesh');
  const items = Array.from({ length: 8 }, (_, i) => ({ ...plan.items[0], id: `p${i}` }));
  expect(() => rewriteMaterials({ ...graph.state, plan: { ...plan, items, replace: items.map(item => item.id) } })).toThrow('最多 8 个参考');
  const failed = { ...newVideoCard('mesh', 2), note: 'ComfyUI 失败' };
  expect(retryRewriteMedia(failed)).toBe(true);
  expect(retryRewriteMedia({ ...failed, startedAt: 'running' })).toBe(false);
  expect(retryRewriteMedia({ ...failed, depthJobId: 'job' })).toBe(false);
  expect(retryRewriteMedia({ ...failed, results: [{ type: 'work', id: 'result', media: 'video' }] })).toBe(false);
  expect(retryRewriteMedia({ ...failed, note: null })).toBe(false);
});

it('作品库白模卡的当前结果标记也决定用途，翻到普通视频后不残留白模用途', () => {
  const graph = start('mesh');
  const outputId = graph.state.videoId!;
  const work = { id: 'from-library', type: 'card' as const, position: { x: 100, y: 100 },
    data: newVideoCard('work', 8, [{ ...asset, type: 'work', mesh: true }, { ...asset, type: 'work', id: 'ordinary' }]) };
  const args = [work, ...graph.nodes], edges = [{ source: work.id, target: outputId }];
  expect(videoRewriteMaterials(args, edges, outputId)[0].purpose).toBe(REWRITE_MESH_PURPOSE);
  work.data.page = 1;
  expect(videoRewriteMaterials(args, edges, outputId)[0].purpose).toBe('深度，参考机位、动作、空间和遮挡节奏');
});
