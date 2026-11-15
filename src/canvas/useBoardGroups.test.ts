import { beforeEach, expect, it, vi } from 'vitest';
import { useBoardGroups } from './useBoardGroups';
import { useBoardActions } from './useBoardActions';
import { newCard, newVideoCard } from '@/domain/cards';
import type { CardNode } from '@/types';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)>,
  graph: { nodes: [] as CardNode[], edges: [] as Array<{ id: string; source: string; target: string }> } }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useLayoutEffect: (effect: () => void) => { effect(); }
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => hooks.graph.nodes, getEdges: () => hooks.graph.edges,
  getZoom: () => 2, screenToFlowPosition: (point: unknown) => point }) }));

const notify = vi.fn();
const setter = (key: 'nodes' | 'edges') => (value: unknown) => {
  const result = typeof value === 'function' ? value(hooks.graph[key]) : value;
  hooks.graph = { ...hooks.graph, [key]: result };
};
const doc = () => ({ ready: true, ...hooks.graph, setNodes: setter('nodes'), setEdges: setter('edges') }) as Parameters<typeof useBoardGroups>[0];
const render = () => { hooks.index = 0; hooks.effects = []; return useBoardGroups(doc(), notify); };
const event = (type: string, x: number, y: number, pointerId = 1) => Object.assign(new Event(type, { cancelable: true }), { clientX: x, clientY: y, pointerId });

beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.effects = [];
  hooks.graph = { nodes: ['a', 'b', 'c'].map((id, index) => ({ id, type: 'card', position: { x: index * 400, y: 0 },
    selected: index < 2, data: newCard('generate', index + 1) })), edges: [] };
  notify.mockClear();
  vi.stubGlobal('window', new EventTarget()); vi.stubGlobal('Element', class {});
});

it('打组后点成员只选该卡，解组去掉group；不足2张提示原话', () => {
  render().makeGroup();
  const grouped = render();
  expect(grouped.selected).toBe(hooks.graph.nodes[0].data.group?.id);
  grouped.selectCard('b');
  expect(render().selected).toBeNull();
  expect(hooks.graph.nodes.map(n => n.selected)).toEqual([false, true, false]);
  render().makeGroup();
  expect(notify).toHaveBeenCalledWith('至少选 2 张卡才能打组');
  render().select(hooks.graph.nodes[0].data.group!.id);
  render().ungroup();
  expect(hooks.graph.nodes.every(n => !n.data.group)).toBe(true);
});

it('拖组按缩放换算相同位移，保留拖动中生成结果，松手结束拖动', () => {
  render().makeGroup();
  const groups = render(), id = groups.selected!;
  groups.onPointerDown({ button: 0, pointerId: 1, clientX: 100, clientY: 100,
    preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Parameters<typeof groups.onPointerDown>[0], id);
  window.dispatchEvent(event('pointermove', 104, 100));
  expect(hooks.graph.nodes[0].dragging).toBeUndefined();
  window.dispatchEvent(event('pointermove', 160, 120));
  expect(hooks.graph.nodes[0].position).toEqual({ x: 30, y: 10 });
  hooks.graph.nodes[0].data.results = [{ type: 'work', id: 'finished' }];
  window.dispatchEvent(event('pointermove', 200, 160));
  window.dispatchEvent(event('pointerup', 200, 160));
  expect(hooks.graph.nodes.map(n => n.position)).toEqual([{ x: 50, y: 30 }, { x: 450, y: 30 }, { x: 800, y: 0 }]);
  expect(hooks.graph.nodes[0].data.results).toEqual([{ type: 'work', id: 'finished' }]);
  expect(hooks.graph.nodes.slice(0, 2).every(n => n.dragging === false)).toBe(true);
});

it('组选中交给原删除入口，生成中白模卡先确认停止', () => {
  hooks.graph.nodes[1].data = { ...newVideoCard('mesh', 2), jobs: ['working'], depthJobId: 'working' };
  render().makeGroup();
  const id = render().selected!;
  const stop = vi.fn().mockResolvedValue(undefined);
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false };
  const selection = render();
  const operation = () => { hooks.index = 3; return useBoardActions(doc(), history, () => {}, notify, stop, selection); };
  operation().remove();
  expect(operation().pendingRemove).toMatchObject({ ids: ['a', 'b'], count: 1 });
  operation().confirmRemove();
  expect(stop).toHaveBeenCalledWith(['a', 'b']);
  expect(hooks.graph.nodes.map(n => n.id)).toEqual(['c']);
  expect(id).toBeTruthy();
});

it('单卡人物组选中只显示组状态，复制粘贴清旧组选中并保留新组和characterId', () => {
  const group = { id: 'person-group', name: '测试人物', characterId: 'person' };
  hooks.graph.nodes[0].data.group = group;
  render().select(group.id);
  const selection = render();
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false };
  const operation = () => { hooks.index = 3; return useBoardActions(doc(), history, () => {}, notify, undefined, selection); };
  operation().copy();
  operation().paste({ x: 200, y: 300 });
  expect(render().selected).toBeNull();
  expect(hooks.graph.nodes).toHaveLength(4);
  const pasted = hooks.graph.nodes[3];
  expect(pasted.data.group).toMatchObject({ name: '测试人物', characterId: 'person' });
  expect(pasted.data.group?.id).not.toBe(group.id);
  expect(pasted.position).toEqual({ x: 200, y: 300 });
  expect(hooks.graph.nodes.filter(n => n.selected).map(n => n.id)).toEqual([pasted.id]);
});

it('存人物获取最新选中节点时沿用点击先后顺序', () => {
  hooks.graph.nodes[0].selected = false;
  render();
  const history = { undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false };
  const operation = () => { hooks.index = 3; return useBoardActions(doc(), history, () => {}, notify); };
  expect(operation().selectedNodes().map(n => n.id)).toEqual(['b']);
  hooks.graph.nodes[0].selected = true;
  expect(operation().selectedNodes().map(n => n.id)).toEqual(['b', 'a']);
});
