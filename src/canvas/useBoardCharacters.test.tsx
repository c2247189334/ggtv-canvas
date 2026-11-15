import { beforeEach, expect, it, vi } from 'vitest';
import { useBoardCharacters } from './useBoardCharacters';
import { api } from '@/api';
import { requestCharacterAdd } from '@/library/characterEvents';
import { newCard } from '@/domain/cards';
import type { CharacterView } from '@/characterTypes';
import type { CardNode } from '@/types';

const hooks = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as Array<() => void | (() => void)>,
  nodes: [] as CardNode[], edges: [] as Array<{ id: string; source: string; target: string; selected?: boolean }> }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (value: unknown) => { hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.values)) hooks.values[index] = { current: initial };
    return hooks.values[index];
  },
  useEffect: (effect: () => void) => { hooks.effects.push(effect); }
}));
vi.mock('@xyflow/react', () => ({ useReactFlow: () => ({ getNodes: () => hooks.nodes, screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: x / 2, y: y / 2 }) }) }));
vi.mock('@/api', () => ({ api: { listCharacters: vi.fn(), saveCharacter: vi.fn() } }));
vi.mock('@/library/worksEvents', () => ({ isWorkDeleted: () => false, bumpWorks: vi.fn() }));
const notify = vi.fn(), clear = vi.fn();
const person: CharacterView = { id: 'p', name: '人物', description: '', createdAt: '', updatedAt: '', status: 'ready', images: [
  { ref: { type: 'work', id: 'w' }, label: '图 1', video: { status: 'trusted', days: 30 } }
] };
const selected = () => [...hooks.nodes].reverse().filter(node => node.selected);
const render = () => {
  hooks.index = 0; hooks.effects = [];
  const doc = { ready: true,
    setNodes: (update: (nodes: CardNode[]) => CardNode[]) => { hooks.nodes = update(hooks.nodes); },
    setEdges: (update: (edges: typeof hooks.edges) => typeof hooks.edges) => { hooks.edges = update(hooks.edges); }
  } as Parameters<typeof useBoardCharacters>[0];
  return useBoardCharacters(doc, notify, selected, clear);
};
beforeEach(() => {
  hooks.values = []; hooks.index = 0; hooks.effects = []; hooks.edges = [];
  hooks.nodes = ['a', 'b'].map(id => ({ id, type: 'card', position: { x: 0, y: 0 }, selected: true,
    data: newCard('work', 1, [{ type: 'work', id }]) }));
  vi.clearAllMocks();
  vi.mocked(api.listCharacters).mockResolvedValue([person]); vi.mocked(api.saveCharacter).mockResolvedValue(person);
  vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => ({ left: 100, top: 0, width: 1000, height: 800 }) }) });
});

it('打开存人物按选中顺序快照当前结果，保存后原话提示并关闭', async () => {
  render().openSave();
  expect(render().images).toEqual([{ type: 'work', id: 'b' }, { type: 'work', id: 'a' }]);
  await render().save({ name: '人物', description: '', authorized: false });
  expect(api.saveCharacter).toHaveBeenCalledWith({ name: '人物', description: '', authorized: false,
    images: [{ type: 'work', id: 'b' }, { type: 'work', id: 'a' }] });
  expect(notify).toHaveBeenCalledWith('已存进人物库：人物'); expect(render().images).toBeNull();
});

it('一张图的人物拖放用最新清单、在松手画布坐标放普通卡，详情广播在可见画布中心放', async () => {
  await render().drop('{"id":"p"}', { x: 20, y: 40 });
  expect(hooks.nodes.at(-1)?.position).toEqual({ x: 20, y: 40 });
  expect(hooks.nodes.filter(node => node.selected)).toHaveLength(1);
  render(); const disposers = hooks.effects.map(effect => effect());
  requestCharacterAdd(person);
  expect(hooks.nodes.at(-1)?.position).toEqual({ x: 160, y: 40 });
  expect(hooks.nodes.at(-1)?.data).not.toHaveProperty('group');
  expect(clear).toHaveBeenCalled();
  for (const dispose of disposers) if (typeof dispose === 'function') dispose();
});

it('人物已删或接口失败只提示，卸载后的迟到拖放不添卡', async () => {
  vi.mocked(api.listCharacters).mockResolvedValueOnce([]).mockRejectedValueOnce(Error('人物读取原话'));
  await render().drop('{"id":"p"}', { x: 1, y: 2 });
  expect(notify).toHaveBeenCalledWith('人物已经不在了。');
  await render().drop('{"id":"p"}', { x: 1, y: 2 });
  expect(notify).toHaveBeenCalledWith('人物读取原话'); expect(hooks.nodes).toHaveLength(2);
  let finish!: (list: CharacterView[]) => void;
  vi.mocked(api.listCharacters).mockImplementationOnce(() => new Promise(yes => { finish = yes; }));
  const board = render(), disposers = hooks.effects.map(effect => effect());
  const pending = board.drop('{"id":"p"}', { x: 1, y: 2 });
  for (const dispose of disposers) if (typeof dispose === 'function') dispose();
  finish([person]); await pending;
  expect(hooks.nodes).toHaveLength(2);
});

const slot = () => ({ id: 'slot', type: 'card' as const, position: { x: 0, y: 0 }, data: { ...newCard('generate', 2), rewriteId: 'r', title: '人物' } });

it('11-06 人物拖到改写空卡：图填进这张卡，不新建卡、不动选中和提示词', async () => {
  hooks.nodes = [...hooks.nodes, { ...slot(), data: { ...slot().data, prompt: '模板' } }];
  const before = hooks.nodes.length;
  await render().drop('{"id":"p"}', { x: 1, y: 2 }, 'slot');
  expect(hooks.nodes).toHaveLength(before);
  expect(hooks.nodes.find(node => node.id === 'slot')!.data).toMatchObject({ results: [{ type: 'work', id: 'w' }], page: 0, prompt: '模板', note: null });
  expect(hooks.nodes.find(node => node.id === 'a')!.selected).toBe(true);
  expect(notify).not.toHaveBeenCalled();
});

it('11-06 改写卡已有图：人物图加成新一页并翻到这一页', async () => {
  hooks.nodes = [{ ...slot(), data: { ...slot().data, results: [{ type: 'work', id: 'old' }] } }];
  await render().drop('{"id":"p"}', { x: 1, y: 2 }, 'slot');
  expect(hooks.nodes[0].data).toMatchObject({ results: [{ type: 'work', id: 'old' }, { type: 'work', id: 'w' }], page: 1 });
});

it('11-06 人物有真人素材编号：填图并提示编号没带过来', async () => {
  vi.mocked(api.listCharacters).mockResolvedValue([{ ...person, images: [{ ...person.images[0], assetId: 'asset-1' }] }]);
  hooks.nodes = [slot()];
  await render().drop('{"id":"p"}', { x: 1, y: 2 }, 'slot');
  expect(hooks.nodes[0].data.results).toHaveLength(1);
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('真人素材编号'));
});

it('11-06 拖到正在生成的卡：只提示，不填图也不新建', async () => {
  hooks.nodes = [{ ...slot(), data: { ...slot().data, jobs: ['job'] } }];
  await render().drop('{"id":"p"}', { x: 1, y: 2 }, 'slot');
  expect(hooks.nodes).toHaveLength(1); expect(hooks.nodes[0].data.results).toHaveLength(0);
  expect(notify).toHaveBeenCalledWith('这张卡正在生成，请等生成结束后再放图片。');
});
