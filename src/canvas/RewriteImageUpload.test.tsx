import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cardCounter, newCard, newVideoCard } from "@/domain/cards";
import { handleCanvasDrop, uploadRewriteImage, RewriteImageUpload } from "./RewriteImageUpload";
import { pickFiles } from "@/common/pickFiles";
import { uploadMedia } from "./uploadMedia";
import type { CardNode } from '@/types';
import { patchCard } from '@/domain/sendRefs';
import { emptyHistory, recordHistory } from '@/domain/history';
import { fromDoc, toDoc } from '@/domain/canvasDoc';
import { prepareRewriteCards, startVideoRewrite } from '@/domain/videoRewrite';
import { lookPromptProblem, lookPromptRequest } from '@/domain/rewritePrompt';
import { RewritePromptButtonView } from './RewritePromptButton';
import type { RewritePlan } from '@/videoRewriteTypes';

function setupDrop() {
  const node: CardNode = { id: 'replace', type: 'card', position: { x: 0, y: 0 }, selected: false,
    data: { ...newCard('generate', 1, [{ type: 'upload', id: 'old' }]), rewriteId: 'r', prompt: '保留提示词', note: '旧错误' } };
  const graph = { nodes: [node], edges: [{ id: 'line', source: 'replace', target: 'video' }] };
  const before = structuredClone(graph);
  const board = { notify: vi.fn(), addAssets: vi.fn(), dropFiles: vi.fn(),
    updateCard: vi.fn((id, patch) => { graph.nodes = graph.nodes.map(n => n.id === id ? { ...n, data: patchCard(n.data, patch) } : n); }) };
  const run = (work = '', files: File[] = [], id: string | null = node.id) =>
    handleCanvasDrop(graph.nodes, id, { work, files }, { x: 12, y: 34 }, board);
  return { graph, board, before, run };
}

it('作品图追加翻页清错误，不上传、不新建、不改变连线/提示词和历史', async () => {
  const s = setupDrop(); vi.mocked(uploadMedia).mockClear();
  await s.run(JSON.stringify({ id: 'library-image', kind: 'image' }));
  expect(s.graph.nodes).toHaveLength(1);
  expect(s.graph.nodes[0].data).toEqual({ ...s.before.nodes[0].data,
    results: [{ type: 'upload', id: 'old' }, { type: 'work', id: 'library-image' }], page: 1, note: null });
  expect(s.graph.edges).toEqual(s.before.edges);
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(s.board.addAssets).not.toHaveBeenCalled(); expect(s.board.dropFiles).not.toHaveBeenCalled();
  expect(recordHistory(emptyHistory(), s.before, s.graph)).toEqual(emptyHistory());
});

it('电脑多图只上传第一张并追加翻页，不改变标题和提示词', async () => {
  const s = setupDrop(); const file = new File(['png'], 'one.png', { type: 'image/png' });
  vi.mocked(uploadMedia).mockClear().mockResolvedValue([{ type: 'upload', id: 'new', fileName: 'one.png' }]);
  await s.run('', [file, new File(['png'], 'two.png', { type: 'image/png' })]);
  expect(uploadMedia).toHaveBeenCalledWith([file], false, s.board.notify);
  expect(s.graph.nodes[0].data).toEqual({ ...s.before.nodes[0].data,
    results: [{ type: 'upload', id: 'old' }, { type: 'upload', id: 'new' }], page: 1, note: null });
  expect(s.board.addAssets).not.toHaveBeenCalled(); expect(s.board.dropFiles).not.toHaveBeenCalled();
});

it('错误媒体和生成中的卡给出提示，结果不变且不新建', async () => {
  for (const kind of ['video', 'audio', 'file', 'busy']) {
    const s = setupDrop(); vi.mocked(uploadMedia).mockClear();
    if (kind === 'busy') s.graph.nodes[0].data.jobs = ['job'];
    const before = structuredClone(s.graph);
    await s.run(kind === 'file' ? '' : JSON.stringify({ id: 'w', kind: kind === 'busy' ? 'image' : kind }),
      kind === 'file' ? [new File(['x'], 'x.txt', { type: 'text/plain' })] : []);
    expect(s.graph).toEqual(before); expect(s.board.notify).toHaveBeenCalledWith(expect.stringMatching(kind === 'busy' ? /正在生成/ : /只能放图片/));
    expect(uploadMedia).not.toHaveBeenCalled(); expect(s.board.updateCard).not.toHaveBeenCalled();
    expect(s.board.addAssets).not.toHaveBeenCalled(); expect(s.board.dropFiles).not.toHaveBeenCalled();
  }
});

it('普通图片卡和空白仍在鼠标处新建作品或文件卡', async () => {
  for (const id of ['replace', null]) {
    const s = setupDrop(); delete (s.graph.nodes[0].data as import('@/types').ImageCardData).rewriteId;
    await s.run(JSON.stringify({ id: 'w', kind: 'image' }), [], id);
    expect(s.board.addAssets).toHaveBeenCalledWith('work', [{ type: 'work', id: 'w' }], { x: 12, y: 34 });
    const file = new File(['png'], 'one.png', { type: 'image/png' });
    await s.run('', [file], id);
    expect(s.board.dropFiles).toHaveBeenCalledWith([file], { x: 12, y: 34 });
    expect(s.board.updateCard).not.toHaveBeenCalled();
  }
});

it('拆解铺卡后全部拖入作品图，写词按钮可点、请求用当前作品，存档重读保留补图', async () => {
  const plan: RewritePlan = { summary: '展示', items: [
    { id: 'person', kind: '人物', desc: '原人物', from: 0, to: 6, frame: 1 },
    { id: 'dress', kind: '衣服', desc: '原衣服', from: 0, to: 6, frame: 1 }
  ], replace: ['person', 'dress'], changes: [], actions: [{ from: 0, to: 6, desc: '站立' }], unsure: [] };
  const source: CardNode = { id: 'source', type: 'card', position: { x: 0, y: 0 },
    data: newVideoCard('upload', 1, [{ type: 'upload', id: 'source-video', media: 'video', seconds: 6, hasAudio: false }]) };
  let serial = 0;
  const args = { takeNumber: cardCounter(), makeId: () => `new-${++serial}` };
  const start = startVideoRewrite({ ...args, source, nodes: [source], edges: [], userText: '换人换衣服' });
  const graph = prepareRewriteCards({ ...args, ...start, state: { ...start.state, plan } });
  const video = graph.nodes.find(node => node.id === graph.videoId)!;
  if (video.data.kind !== 'video') throw Error('expected video');
  const state = () => ({ id: video.id, data: video.data as import('@/types').VideoCardData, nodes: graph.nodes, edges: graph.edges });
  expect(lookPromptProblem(state())).toContain('还差 2 张图');
  const board = { notify: vi.fn(), addAssets: vi.fn(), dropFiles: vi.fn(),
    updateCard: (id: string, patch: import('@/types').CardPatch) => { graph.nodes = graph.nodes.map(node => node.id === id ? { ...node, data: patchCard(node.data, patch) } : node); } };
  const size = graph.nodes.length;
  for (const [itemId, id] of Object.entries(graph.imageIds)) {
    await handleCanvasDrop(graph.nodes, id, { work: JSON.stringify({ id: `work-${itemId}`, kind: 'image' }), files: [] }, { x: 0, y: 0 }, board);
  }
  expect(graph.nodes).toHaveLength(size); expect(board.addAssets).not.toHaveBeenCalled();
  expect(lookPromptProblem(state())).toBeNull();
  const button = renderToStaticMarkup(<RewritePromptButtonView loading={false} reason={lookPromptProblem(state())} onRun={vi.fn()} />);
  expect(button).toContain('生成提示词'); expect(button).not.toContain('disabled=""');
  expect(lookPromptRequest(state()).materials.filter(row => row.itemId).map(row => row.asset))
    .toEqual([{ type: 'work', id: 'work-person' }, { type: 'work', id: 'work-dress' }]);
  const restored = fromDoc(toDoc({ id: 'c', name: 'test' }, graph.nodes, graph.edges));
  for (const id of Object.values(graph.imageIds)) {
    expect(restored.nodes.find(node => node.id === id)?.data.results).toEqual(graph.nodes.find(node => node.id === id)?.data.results);
  }
  expect(restored.edges).toEqual(graph.edges);
});

it('上传等待时以最新卡结果追加，卡已删除或开始生成时不写入也不另建', async () => {
  for (const change of ['append', 'delete', 'busy']) {
    const s = setupDrop(); let resolve!: (refs: Awaited<ReturnType<typeof uploadMedia>>) => void;
    vi.mocked(uploadMedia).mockImplementationOnce(() => new Promise(yes => { resolve = yes; }));
    const pending = handleCanvasDrop(s.graph.nodes, 'replace', { work: '', files: [new File(['png'], 'one.png', { type: 'image/png' })] },
      { x: 0, y: 0 }, s.board, () => s.graph.nodes);
    if (change === 'delete') s.graph.nodes = [];
    if (change === 'busy') s.graph.nodes[0].data.jobs = ['job'];
    if (change === 'append') s.graph.nodes[0].data.results.push({ type: 'work', id: 'meanwhile' });
    resolve([{ type: 'upload', id: 'new', fileName: 'one.png' }]); await pending;
    if (change === 'append') expect(s.graph.nodes[0].data).toMatchObject({ results: [
      { type: 'upload', id: 'old' }, { type: 'work', id: 'meanwhile' }, { type: 'upload', id: 'new' }], page: 2 });
    else expect(s.board.updateCard).not.toHaveBeenCalled();
    expect(s.board.addAssets).not.toHaveBeenCalled(); expect(s.board.dropFiles).not.toHaveBeenCalled();
  }
});

vi.mock("@/common/pickFiles", () => ({ pickFiles: vi.fn() }));
vi.mock("./uploadMedia", () => ({ uploadMedia: vi.fn() }));
vi.mock("./boardContext", () => ({ useBoard: () => ({}) }));
it("补图直接填回原图片卡，标题/提示词/输出连线不变，普通图不加入口", async () => {
  const data = { ...newCard("generate", 1), rewriteId: "r", rewriteItemId: "person", prompt: "单人" };
  const updateCard = vi.fn();
  vi.mocked(pickFiles).mockResolvedValue([new File(["image"], "person.png")]);
  vi.mocked(uploadMedia).mockResolvedValue([{ type: "upload", id: "u", fileName: "person.png" }]);
  await uploadRewriteImage("same-image", data, { updateCard, notify: vi.fn() });
  expect(updateCard).toHaveBeenCalledWith("same-image", { results: [{ type: "upload", id: "u" }], page: 0, note: null });
  expect(renderToStaticMarkup(<RewriteImageUpload id="same-image" data={data} />)).toContain("上传这项图片");
  expect(renderToStaticMarkup(<RewriteImageUpload id="ordinary" data={newCard("generate", 2)} />)).toBe("");
});
