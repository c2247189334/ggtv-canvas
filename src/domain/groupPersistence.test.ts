import { describe, expect, it } from 'vitest';
import { newCard, newVideoCard, newAudioCard } from './cards';
import { fromDoc, readCard, toDoc } from './canvasDoc';
import { emptyHistory, observeHistory, undoHistory, redoHistory, sameStructure, type Graph } from './history';
import type { CardNode } from '@/types';

const group = { id: 'group-a', name: 'Group 1', characterId: 'person' };
const graph = (grouped: boolean): Graph => ({ nodes: [{ id: 'a', type: 'card', position: { x: 12, y: 20 },
  data: { ...newCard('generate', 1), ...(grouped ? { group } : {}) } }], edges: [] });

describe('成组存档和历史', () => {
  it('图片、视频、声音都保留完整组信息，旧档不添组', () => {
    const nodes: CardNode[] = [newCard('generate', 1), newVideoCard('upload', 2), newAudioCard('work', 3)]
      .map((data, index) => ({ id: String(index), type: 'card', position: { x: index * 100, y: 0 }, data: { ...data, group } }));
    const restored = fromDoc(JSON.parse(JSON.stringify(toDoc({ id: 'c', name: '画布' }, nodes, []))));
    expect(restored.nodes.map(n => n.data)).toEqual(nodes.map(n => n.data));
    expect(readCard(newCard('generate', 1))).not.toHaveProperty('group');
  });
  it.each([null, '', [], {}, { id: '', name: 'x' }, { id: 'g', name: '' }, { id: 3, name: 'x' },
    { id: 'g', name: 'x', characterId: 7 }])('坏组信息 %j 丢掉，卡仍可用', invalid => {
    const card = readCard({ ...newCard('generate', 1), group: invalid });
    expect(card).not.toHaveProperty('group');
    expect(card?.kind).toBe('image');
  });
  it('打组、解组都计步，撤销重做组信息并保留生成进度', () => {
    expect(sameStructure(graph(false), graph(true))).toBe(false);
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, graph(false));
    frame = observeHistory(frame, graph(true));
    expect(frame.history.past).toHaveLength(1);
    const current = graph(true);
    current.nodes[0].data.prompt = '后来编辑';
    current.nodes[0].data.results = [{ type: 'work', id: 'finished' }];
    const undone = undoHistory(frame.history, current);
    expect(undone.graph.nodes[0].data).not.toHaveProperty('group');
    expect(undone.graph.nodes[0].data.prompt).toBe('后来编辑');
    const redone = redoHistory(undone.history, undone.graph);
    expect(redone.graph.nodes[0].data).toMatchObject({ group, results: current.nodes[0].data.results });
    frame = observeHistory(frame, graph(false));
    expect(frame.history.past).toHaveLength(2);
    expect(undoHistory(frame.history, graph(false)).graph.nodes[0].data).toHaveProperty('group', group);
  });
});
