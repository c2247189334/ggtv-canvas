import { describe, expect, it } from 'vitest';
import { clipChild, clipKeyRange, clipPlaybackTime, clipTicks, defaultClipRange, moveClipHandle, snapClipTime, translateClipRange } from './videoClip';
import { cardCounter, cardTitle, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { emptyHistory, observeHistory, undoHistory, redoHistory } from './history';
import type { CardNode } from '@/types';

describe('视频截取纯计算', () => {
  it('默认取三分之一且至少1秒', () => {
    expect(defaultClipRange(9)).toEqual({ start: 0, end: 3 });
    expect(defaultClipRange(2)).toEqual({ start: 0, end: 1 });
  });
  it('左右把手夹边、至少1秒，移动右把手不改变开头', () => {
    expect(moveClipHandle({ start: 2, end: 5 }, 'start', -3, 9)).toEqual({ start: 0, end: 5 });
    expect(moveClipHandle({ start: 2, end: 5 }, 'start', 8, 9)).toEqual({ start: 4, end: 5 });
    expect(moveClipHandle({ start: 2, end: 5 }, 'end', 0, 9)).toEqual({ start: 2, end: 3 });
    expect(moveClipHandle({ start: 2, end: 5 }, 'end', 99, 9)).toEqual({ start: 2, end: 9 });
  });
  it('整段平移保持长度，两端碰边停止', () => {
    expect(translateClipRange({ start: 2, end: 5 }, -8, 9)).toEqual({ start: 0, end: 3 });
    expect(translateClipRange({ start: 2, end: 5 }, 8, 9)).toEqual({ start: 6, end: 9 });
  });
  it.each([false, true])('方向键普通0.1秒，Ctrl/⌘为1秒：%s', fast => {
    const step = fast ? 1 : 0.1, range = { start: 2, end: 5 };
    expect(clipKeyRange(range, 'ArrowLeft', 9, 0, fast)).toEqual({ start: 2 - step, end: 5 - step });
    expect(clipKeyRange(range, 'ArrowRight', 9, 0, fast)).toEqual({ start: 2 + step, end: 5 + step });
    expect(clipKeyRange(range, 'ArrowUp', 9, 0, fast)).toEqual({ start: 2, end: 5 - step });
    expect(clipKeyRange(range, 'ArrowDown', 9, 0, fast)).toEqual({ start: 2, end: 5 + step });
    expect(clipKeyRange({ start: 8, end: 9 }, 'ArrowDown', 9, 0, fast)).toEqual({ start: 8, end: 9 });
    expect(clipKeyRange({ start: 2, end: 3 }, 'ArrowUp', 9, 0, fast)).toEqual({ start: 2, end: 3 });
  });
  it('I/O使用当前播放时间并夹边', () => {
    expect(clipKeyRange({ start: 2, end: 5 }, 'i', 9, 3.2)).toEqual({ start: 3.2, end: 5 });
    expect(clipKeyRange({ start: 2, end: 5 }, 'I', 9, 8)).toEqual({ start: 4, end: 5 });
    expect(clipKeyRange({ start: 2, end: 5 }, 'o', 9, 1)).toEqual({ start: 2, end: 3 });
    expect(clipKeyRange({ start: 2, end: 5 }, 'O', 9, 8)).toEqual({ start: 2, end: 8 });
  });
  it('整数秒吸附阈值为0.1，关闭时不吸附', () => {
    expect(snapClipTime(3.9, true)).toBe(4);
    expect(snapClipTime(4.1, true)).toBe(4);
    expect(snapClipTime(3.85, true)).toBe(3.85);
    expect(snapClipTime(3.95, false)).toBe(3.95);
    expect(moveClipHandle({ start: 0, end: 4 }, 'end', 5.95, 9, true).end).toBe(6);
  });
  it('精确模式12秒共23条半秒刻度，不画两端', () => {
    expect(clipTicks(12, true)).toEqual(Array.from({ length: 23 }, (_, i) => (i + 1) / 2));
    expect(clipTicks(12, false)).toEqual([]);
  });
  it('循环播放到结尾返回开头，关闭循环不动', () => {
    expect(clipPlaybackTime(5, { start: 2, end: 5 }, true)).toBe(2);
    expect(clipPlaybackTime(6, { start: 2, end: 5 }, true)).toBe(2);
    expect(clipPlaybackTime(4.9, { start: 2, end: 5 }, true)).toBe(4.9);
    expect(clipPlaybackTime(5, { start: 2, end: 5 }, false)).toBe(5);
  });
});

it('剪辑不占编号、右侧建上传卡和来源线，保存刷新、一次撤销重做保留全部元数据', () => {
  const take = cardCounter();
  const source: CardNode = { id: 'source', type: 'card', position: { x: 10, y: 20 }, selected: true,
    data: newVideoCard('work', take(), [{ type: 'work', id: 'original', media: 'video', seconds: 9 }]) };
  const upload = { id: 'clip', kind: 'video' as const, duration: 3, width: 864, height: 480, fps: 30, hasAudio: true };
  const created = clipChild(source, source.data.results[0], upload, 'new');
  expect(created.node.position).toEqual({ x: 390, y: 20 });
  expect(created.node.data).toMatchObject({ kind: 'video', source: 'upload', title: '剪辑', number: 0,
    mediaSource: source.data.results[0], results: [{ type: 'upload', id: 'clip', media: 'video', seconds: 3, width: 864, height: 480, fps: 30, hasAudio: true }] });
  expect(cardTitle(created.node.data)).toBe('剪辑');
  expect(take()).toBe(2);
  const before = { nodes: [source], edges: [] };
  const after = { nodes: [{ ...source, selected: false }, created.node], edges: [created.edge] };
  const initial = observeHistory({ history: emptyHistory(), baseline: null }, before);
  const recorded = observeHistory(initial, after);
  expect(recorded.history.past).toHaveLength(1);
  const undo = undoHistory(recorded.history, after);
  expect(undo.graph.nodes).toHaveLength(1); expect(undo.graph.edges).toHaveLength(0);
  const redo = redoHistory(undo.history, undo.graph);
  expect(redo.graph).toEqual(after);
  const loaded = fromDoc(toDoc({ id: 'c', name: 'c' }, after.nodes, after.edges));
  expect(loaded.nodes[1].data).toEqual(created.node.data);
  expect(loaded.edges).toEqual(after.edges);
});
