import { expect, it } from 'vitest';
import { characterNodes, characterSaveImages, characterSaveProblem, characterDropId } from './characterCanvas';
import { newCard, newVideoCard } from './cards';
import { fromDoc, toDoc } from './canvasDoc';
import { emptyHistory, recordHistory, undoHistory, redoHistory } from './history';
import type { CharacterView } from '@/characterTypes';
import type { CardNode } from '@/types';

const person: CharacterView = { id: 'person', name: '阿青', description: '', createdAt: '', updatedAt: '', status: 'ready', images: [
  { ref: { type: 'work', id: 'w' }, label: '图 1', assetId: 'asset-1', video: { status: 'asset' } },
  { ref: { type: 'upload', id: 'u' }, label: '图 2', video: { status: 'photo' } }
] };
const node = (id: string): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, selected: true,
  data: newCard('generate', 1, [{ type: 'work', id: `old-${id}` }, { type: 'upload', id: `now-${id}` }]) });

it('存人物按输入选中顺序取当前页和素材编号，非图片/空结果/多于8张不能存', () => {
  const a = node('a'), b = node('b');
  a.data.page = 1;
  b.data = { ...newCard('work', 0, [{ type: 'work', id: 'result' }]), assetId: 'asset_2' };
  expect(characterSaveImages([b, a])).toEqual([{ type: 'work', id: 'result', assetId: 'asset_2' }, { type: 'upload', id: 'now-a' }]);
  expect(characterSaveImages([])).toBeNull();
  expect(characterSaveImages([{ ...a, data: newCard('generate', 1) }])).toBeNull();
  expect(characterSaveImages([{ ...a, data: newVideoCard('upload', 1, [{ type: 'upload', id: 'v', media: 'video' }]) }])).toBeNull();
  expect(characterSaveImages(Array.from({ length: 9 }, (_, i) => node(String(i))))).toBeNull();
  expect(characterSaveImages([b], new Set(['result']))).toBeNull();
});

it('存人物上传图必须明确授权，作品图不需要勾选，名字描述仍校验', () => {
  const work = [{ type: 'work' as const, id: 'w' }], upload = [{ type: 'upload' as const, id: 'u' }];
  expect(characterSaveProblem({ name: '人', description: '', images: upload, authorized: false })).toBe('先勾选授权');
  expect(characterSaveProblem({ name: '人', description: '', images: upload, authorized: true })).toBeNull();
  expect(characterSaveProblem({ name: '人', description: '', images: work, authorized: false })).toBeNull();
  expect(characterSaveProblem({ name: '', description: '', images: work, authorized: false })).toContain('名字');
});

it('人物图一排间隔24成新组，不取编号并带素材号，存读、撤销重做后保持', () => {
  let serial = 0;
  const nodes = characterNodes(person, { x: 50, y: 90 }, () => `new-${++serial}`);
  expect(nodes.map(n => n.position)).toEqual([{ x: 50, y: 90 }, { x: 354, y: 90 }]);
  expect(nodes.map(n => n.data.number)).toEqual([0, 0]);
  expect(nodes.map(n => n.data.title)).toEqual(['阿青 · 图 1', '阿青 · 图 2']);
  expect(nodes[0].data.group).toEqual(nodes[1].data.group);
  expect(nodes[0].data.group).toMatchObject({ name: '阿青', characterId: 'person' });
  expect(nodes[0].data.kind === 'image' && nodes[0].data.assetId).toBe('asset-1');
  expect(characterNodes(person, { x: 0, y: 0 })[0].data.group?.id).not.toBe(nodes[0].data.group?.id);
  const restored = fromDoc(JSON.parse(JSON.stringify(toDoc({ id: 'c', name: '画布' }, nodes, []))));
  expect(restored.nodes.map(n => n.data)).toEqual(nodes.map(n => n.data));
  const ungrouped = nodes.map(n => { const { group: _group, ...data } = n.data; return { ...n, data }; });
  expect(fromDoc(toDoc({ id: 'c', name: '画布' }, ungrouped, [])).nodes.map(n => n.data.number)).toEqual([0, 0]);
  const before = { nodes: [], edges: [] }, after = { nodes, edges: [] };
  const history = recordHistory(emptyHistory(), before, after);
  const undone = undoHistory(history, after);
  expect(undone.graph.nodes).toEqual([]);
  expect(redoHistory(undone.history, undone.graph).graph.nodes.map(n => n.data)).toEqual(nodes.map(n => n.data));
  expect(characterNodes({ ...person, images: [] }, { x: 0, y: 0 })).toEqual([]);
});

it('人物拖放只接受正确编号包，坏输入不影响普通作品拖放', () => {
  expect(characterDropId('{"id":"p"}')).toBe('p');
  for (const raw of ['', '{bad', 'null', '{}', '{"id":3}', '{"id":""}']) expect(characterDropId(raw)).toBeNull();
});

it('11-06 只有一张图的人物拖出来是普通图片卡，不成组；标题和素材编号照旧', () => {
  const single = { ...person, images: [person.images[0]] };
  const [card, ...rest] = characterNodes(single, { x: 5, y: 6 });
  expect(rest).toEqual([]); expect(card.data).not.toHaveProperty('group');
  expect(card.data).toMatchObject({ kind: 'image', title: '阿青 · 图 1', assetId: 'asset-1', results: [{ type: 'work', id: 'w' }] });
  expect(card.position).toEqual({ x: 5, y: 6 });
});
