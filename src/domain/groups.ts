import type { CardGroup, CardNode } from '@/types';
import type { Graph } from './history';
import { CARD_WIDTH, CARD_HEIGHT, type Point } from './placement';

export function groupsIn(nodes: readonly CardNode[]): CardGroup[] {
  return [...new Map(nodes.filter(n => n.data.group).map(n => [n.data.group!.id, n.data.group!])).values()];
}

export function groupCards(nodes: readonly CardNode[], id = `group-${crypto.randomUUID()}`): { nodes: CardNode[]; group: CardGroup } | null {
  if (nodes.filter(n => n.selected).length < 2) return null;
  const maximum = groupsIn(nodes).reduce((max, group) => {
    const match = /^Group (\d+)$/.exec(group.name);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const group = { id, name: `Group ${maximum + 1}` };
  return { group, nodes: nodes.map(n => n.selected ? { ...n, data: { ...n.data, group } } : n) };
}

export function ungroupCards(nodes: readonly CardNode[], groupId: string): CardNode[] {
  return nodes.map(n => {
    if (n.data.group?.id !== groupId) return n;
    const { group: _group, ...data } = n.data;
    return { ...n, data };
  });
}

export function groupBounds(nodes: readonly CardNode[], groupId: string): { x: number; y: number; width: number; height: number } | null {
  const members = nodes.filter(n => n.data.group?.id === groupId);
  if (!members.length) return null;
  const left = Math.min(...members.map(n => n.position.x));
  const top = Math.min(...members.map(n => n.position.y));
  const right = Math.max(...members.map(n => n.position.x + (n.measured?.width ?? n.width ?? CARD_WIDTH)));
  const bottom = Math.max(...members.map(n => n.position.y + (n.measured?.height ?? n.height ?? CARD_HEIGHT)));
  return { x: left - 24, y: top - 24, width: right - left + 48, height: bottom - top + 48 };
}

export function removeGroup(graph: Graph, groupId: string): Graph {
  const ids = new Set(graph.nodes.filter(n => n.data.group?.id === groupId).map(n => n.id));
  return { nodes: graph.nodes.filter(n => !ids.has(n.id)), edges: graph.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)) };
}

export function selectGroup(graph: Graph, groupId: string): Graph {
  return { nodes: graph.nodes.map(n => ({ ...n, selected: n.data.group?.id === groupId })),
    edges: graph.edges.map(e => ({ ...e, selected: false })) };
}

export function selectGroupCard(graph: Graph, cardId: string): Graph {
  return { nodes: graph.nodes.map(n => ({ ...n, selected: n.id === cardId })), edges: graph.edges.map(e => ({ ...e, selected: false })) };
}

/** 使用按下时快照加总位移，避免高频事件累计误差。 */
export function moveGroup(nodes: readonly CardNode[], groupId: string, delta: Point, dragging: boolean): CardNode[] {
  return nodes.map(n => n.data.group?.id === groupId ? {
    ...n, dragging, position: { x: n.position.x + delta.x, y: n.position.y + delta.y }
  } : n);
}

/** 复制时用全画布判断是否完整，组的部分卡不携带组。 */
export function copyGroups(selected: readonly CardNode[], all: readonly CardNode[]): CardNode[] {
  const selectedIds = new Set(selected.map(n => n.id));
  const incomplete = new Set(all.filter(n => n.data.group && !selectedIds.has(n.id)).map(n => n.data.group!.id));
  return selected.map(n => {
    if (!n.data.group || !incomplete.has(n.data.group.id)) return n;
    const { group: _group, ...data } = n.data;
    return { ...n, data };
  });
}

export function pastedGroups(nodes: readonly CardNode[], newId = () => `group-${crypto.randomUUID()}`): CardNode[] {
  const ids = new Map(groupsIn(nodes).map(group => [group.id, newId()]));
  return nodes.map(n => n.data.group ? { ...n, data: { ...n.data, group: { ...n.data.group, id: ids.get(n.data.group.id)! } } } : n);
}

export type GroupLayout = 'grid' | 'horizontal' | 'vertical';
const size = (n: CardNode) => ({ width: n.measured?.width ?? n.width ?? CARD_WIDTH, height: n.measured?.height ?? n.height ?? CARD_HEIGHT });
/** 组工具条「排列」三项：从组左上角排起、间隔 24；宫格列数 = ⌈√张数⌉，每行顶对齐、每列左对齐。 */
export function arrangeGroup(nodes: readonly CardNode[], groupId: string, layout: GroupLayout): CardNode[] {
  const members = nodes.filter(n => n.data.group?.id === groupId)
    .sort((a, b) => Math.round(a.position.y / 160) - Math.round(b.position.y / 160) || a.position.x - b.position.x);
  if (!members.length) return [...nodes];
  const left = Math.min(...members.map(n => n.position.x)), top = Math.min(...members.map(n => n.position.y));
  const cols = layout === 'horizontal' ? members.length : layout === 'vertical' ? 1 : Math.ceil(Math.sqrt(members.length));
  const widths: number[] = [], heights: number[] = [];
  members.forEach((n, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    widths[col] = Math.max(widths[col] ?? 0, size(n).width); heights[row] = Math.max(heights[row] ?? 0, size(n).height);
  });
  const offset = (list: number[], index: number) => list.slice(0, index).reduce((sum, value) => sum + value + 24, 0);
  const positions = new Map(members.map((n, i) => [n.id, { x: left + offset(widths, i % cols), y: top + offset(heights, Math.floor(i / cols)) }]));
  return nodes.map(n => positions.has(n.id) ? { ...n, position: positions.get(n.id)! } : n);
}
