import { describe, expect, it } from 'vitest';
import { FRAME_STACK_STEP, frameChild, frameSecond, frameTitle, stackedFrameSpot } from './videoFrame';
import { cardCounter, cardTitle, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { emptyHistory, observeHistory, undoHistory, redoHistory } from './history';
import { rightOf } from './placement';
import type { CardNode } from '@/types';

describe('视频截图：截哪一秒、叫什么（11-09 用户定照参考软件）', () => {
  it('当前帧标题写到毫秒，超过 1 小时前面加时；首帧、尾帧固定名字', () => {
    expect(frameTitle('current', 4.524)).toBe('截图 00:04.524');
    expect(frameTitle('current', 0)).toBe('截图 00:00.000');
    expect(frameTitle('current', 65.0004)).toBe('截图 01:05.000');
    expect(frameTitle('current', 3725.5)).toBe('截图 01:02:05.500');
    expect(frameTitle('first', 0)).toBe('首帧');
    expect(frameTitle('last', 8.95)).toBe('尾帧');
  });

  it('当前帧用播放器时间，没播过的 0.001 秒算 0；播到头往前挪 0.05 秒免得截空', () => {
    expect(frameSecond('current', { time: 4.524, duration: 9 }, 9)).toBe(4.524);
    expect(frameSecond('current', { time: 0.001, duration: 9 }, 9)).toBe(0);
    expect(frameSecond('current', { time: 9, duration: 9 }, 9)).toBe(8.95);
    expect(frameSecond('current', { time: Number.NaN, duration: Number.NaN }, undefined)).toBe(0);
  });

  it('首帧是 0 秒；尾帧是时长减 0.05 秒，卡上没时长就看播放器，两边都没有返回 null', () => {
    expect(frameSecond('first', { time: 5, duration: 9 }, 9)).toBe(0);
    expect(frameSecond('last', { time: 0, duration: Number.NaN }, 9)).toBe(8.95);
    expect(frameSecond('last', { time: 0, duration: 6 }, undefined)).toBe(5.95);
    expect(frameSecond('last', { time: 0, duration: Number.NaN }, undefined)).toBeNull();
    expect(frameSecond('last', { time: 0, duration: 0.03 }, undefined)).toBe(0);
  });
});

describe('截图卡放哪、连哪', () => {
  const video = (id = 'v'): CardNode => ({ id, type: 'card', position: { x: 10, y: 20 }, selected: true,
    data: newVideoCard('upload', 0, [{ type: 'upload', id: 'clip', media: 'video', seconds: 9 }]) });

  it('放在视频右边顶对齐；那个位置已有卡（包括上一张截图）就往右下错开 30，不往别处躲', () => {
    const base = rightOf({ x: 10, y: 20 });
    expect(stackedFrameSpot(base, [])).toEqual(base);
    const first: CardNode = { ...video('a'), position: base };
    const second: CardNode = { ...video('b'), position: { x: base.x + FRAME_STACK_STEP, y: base.y + FRAME_STACK_STEP } };
    expect(stackedFrameSpot(base, [first])).toEqual({ x: base.x + 30, y: base.y + 30 });
    expect(stackedFrameSpot(base, [first, second])).toEqual({ x: base.x + 60, y: base.y + 60 });
    const nearby: CardNode = { ...video('c'), position: { x: base.x + 5, y: base.y } };
    expect(stackedFrameSpot(base, [nearby])).toEqual(base);
  });

  it('截图卡是不占编号的上传图片卡，记来源视频、不选中；连一根来源线；保存刷新、一次撤销重做都完整', () => {
    const take = cardCounter();
    const source = video();
    const created = frameChild(source, { type: 'upload', id: 'clip', seconds: 9 }, 'frame-1', '截图 00:04.524', 'shot', [source]);
    expect(created.node).toMatchObject({ id: 'shot', type: 'card', position: rightOf(source.position), selected: false });
    expect(created.node.data).toMatchObject({ kind: 'image', source: 'upload', number: 0, title: '截图 00:04.524',
      results: [{ type: 'upload', id: 'frame-1' }], mediaSource: { type: 'upload', id: 'clip', media: 'video', seconds: 9 } });
    expect(cardTitle(created.node.data)).toBe('截图 00:04.524');
    expect(take()).toBe(1);
    expect(created.edge).toEqual({ id: 'link:v>shot', source: 'v', target: 'shot' });

    const before = { nodes: [source], edges: [] };
    const after = { nodes: [source, created.node], edges: [created.edge] };
    const recorded = observeHistory(observeHistory({ history: emptyHistory(), baseline: null }, before), after);
    expect(recorded.history.past).toHaveLength(1);
    const undo = undoHistory(recorded.history, after);
    expect(undo.graph.nodes).toHaveLength(1); expect(undo.graph.edges).toHaveLength(0);
    expect(redoHistory(undo.history, undo.graph).graph).toEqual(after);
    const loaded = fromDoc(toDoc({ id: 'c', name: 'c' }, after.nodes, after.edges));
    expect(loaded.nodes[1].data).toEqual(created.node.data);
    expect(loaded.edges).toEqual([created.edge]);
  });
});
