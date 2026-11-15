import { describe, expect, it } from 'vitest';
import { newCard } from './cards';
import { groupCards, ungroupCards, groupBounds, groupsIn, removeGroup, moveGroup, selectGroup, selectGroupCard } from './groups';
import { copySelection, pasteClipboard } from './clipboard';
import { emptyHistory, observeHistory, undoHistory, redoHistory } from './history';
import type { CardNode } from '@/types';

const node = (id: string, group?: { id: string; name: string }): CardNode => ({ id, type: 'card', selected: true,
  position: { x: 0, y: 0 }, data: { ...newCard('generate', 1), ...(group ? { group } : {}) } });
const old = { id: 'old', name: 'Group 4' };

describe('成组纯逻辑', () => {
  it('少于两张不打组；命名取画布最大Group数字+1，移出旧组且绝对坐标不变', () => {
    const before = [node('a', old), node('b'), { ...node('c', { id: 'other', name: '人物' }), selected: false }];
    expect(groupCards([before[0]], 'g')).toBeNull();
    const result = groupCards(before, 'g')!;
    expect(result.group).toEqual({ id: 'g', name: 'Group 5' });
    expect(result.nodes.slice(0, 2).map(n => n.data.group)).toEqual([result.group, result.group]);
    expect(result.nodes.map(n => n.position)).toEqual(before.map(n => n.position));
    expect(groupsIn(result.nodes).map(g => g.id)).toEqual(['g', 'other']);
    expect(before[0].data.group).toEqual(old);
    expect(groupCards([node('a'), node('b')], 'first')?.group.name).toBe('Group 1');
  });
  it('解组只去目标组；删组连同进出连线一起删', () => {
    const nodes = [node('a', old), node('b', old), node('c')];
    expect(ungroupCards(nodes, old.id).map(n => n.data.group)).toEqual([undefined, undefined, undefined]);
    const edges = [{ id: 'a-c', source: 'a', target: 'c' }, { id: 'c-b', source: 'c', target: 'b' }, { id: 'keep', source: 'c', target: 'c' }];
    expect(removeGroup({ nodes, edges }, old.id)).toEqual({ nodes: [nodes[2]], edges: [edges[2]] });
    expect(groupsIn(removeGroup({ nodes, edges }, old.id).nodes)).toEqual([]);
  });
  it('组框按实测尺寸合并留24，未测量用默认尺寸，空组没有框', () => {
    const a = { ...node('a', old), position: { x: -20, y: 50 }, measured: { width: 300, height: 100 } };
    const b = { ...node('b', old), position: { x: 400, y: -10 } };
    expect(groupBounds([a, b], old.id)).toEqual({ x: -44, y: -34, width: 748, height: 368 });
    expect(groupBounds([a], 'missing')).toBeNull();
    expect(groupBounds([{ ...b, width: 100, height: 80 }], old.id)).toEqual({ x: 376, y: -34, width: 148, height: 128 });
  });
  it('整组选中不选边；点组内一张只选它；拖组松手一步撤销与重做', () => {
    const before = { nodes: [node('a', old), node('b', old), node('c')], edges: [{ id: 'e', source: 'a', target: 'c', selected: true }] };
    const selected = selectGroup(before, old.id);
    expect(selected.nodes.map(n => n.selected)).toEqual([true, true, false]);
    expect(selected.edges[0].selected).toBe(false);
    expect(selectGroupCard(selected, 'b').nodes.map(n => n.selected)).toEqual([false, true, false]);
    let frame = observeHistory({ history: emptyHistory(), baseline: null }, selected);
    const moving = { ...selected, nodes: moveGroup(selected.nodes, old.id, { x: 50, y: 20 }, true) };
    frame = observeHistory(frame, moving);
    expect(frame.history.past).toHaveLength(0);
    const after = { ...selected, nodes: moveGroup(selected.nodes, old.id, { x: 100, y: 40 }, false) };
    frame = observeHistory(frame, after);
    expect(frame.history.past).toHaveLength(1);
    expect(after.nodes.map(n => n.position)).toEqual([{ x: 100, y: 40 }, { x: 100, y: 40 }, { x: 0, y: 0 }]);
    const undone = undoHistory(frame.history, after);
    expect(undone.graph.nodes.map(n => n.position)).toEqual(before.nodes.map(n => n.position));
    expect(redoHistory(undone.history, undone.graph).graph.nodes.map(n => n.position)).toEqual(after.nodes.map(n => n.position));
  });
  it('整组复制换组编号，部分复制去组，原数据保持；多组各换不同编号', () => {
    const nodes = [node('a', old), node('b', old), node('c', { id: 'second', name: '人物' })];
    let id = 0;
    const full = pasteClipboard(copySelection(nodes, []), null, () => `new-${++id}`);
    expect(full.nodes[0].data.group?.id).not.toBe(old.id);
    expect(full.nodes[0].data.group).toEqual(full.nodes[1].data.group);
    expect(full.nodes[2].data.group?.id).not.toBe(full.nodes[0].data.group?.id);
    expect(full.nodes[0].data.group?.name).toBe(old.name);
    const partial = pasteClipboard(copySelection(nodes.map(n => ({ ...n, selected: n.id === 'a' })), []), null);
    expect(partial.nodes[0].data).not.toHaveProperty('group');
    expect(nodes[0].data.group).toEqual(old);
  });
});
