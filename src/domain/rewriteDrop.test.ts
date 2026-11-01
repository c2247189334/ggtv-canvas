import { expect, it } from 'vitest';
import { newAudioCard, newCard, newVideoCard } from './cards';
import { rewriteDropHighlight, rewriteDropPlan } from './rewriteDrop';
import { WORK_IMAGE_DRAG_TYPE } from './media';
import { WorksGrid, WORK_DRAG_TYPE } from '@/library/WorksGrid';
import type { CardNode } from '@/types';

const target: CardNode = { id: 'replace', type: 'card', position: { x: 0, y: 0 },
  data: { ...newCard('generate', 1), rewriteId: 'r' } };
const png = new File(['png'], 'one.png', { type: 'image/png' });
const image = JSON.stringify({ id: 'w', kind: 'image' });

it('作品图片和文件指向未选中的改写图片卡，文件只收第一张', () => {
  expect(rewriteDropPlan([target], target.id, { work: image, files: [] })).toEqual({ kind: 'work', id: target.id, asset: { type: 'work', id: 'w' } });
  expect(rewriteDropPlan([target], target.id, { work: '', files: [png, png] })).toEqual({ kind: 'file', id: target.id, file: png });
});

it.each(['video', 'audio'])('%s作品被拒且不会退回新建卡', kind => {
  expect(rewriteDropPlan([target], target.id, { work: JSON.stringify({ id: 'w', kind }), files: [] }))
    .toEqual({ kind: 'reject', message: '这张卡只能放图片（PNG、JPG、WebP）。' });
});

it('非图片文件、首个文件非图片、损坏作品数据被拒', () => {
  const text = new File(['x'], 'x.txt', { type: 'text/plain' });
  for (const payload of [{ work: '', files: [text, png] }, { work: '{bad', files: [] }]) {
    expect(rewriteDropPlan([target], target.id, payload).kind).toBe('reject');
  }
});

it('正在生成不接受作品或文件', () => {
  const busy = { ...target, data: { ...target.data, jobs: ['job'] } };
  for (const payload of [{ work: image, files: [] }, { work: '', files: [png] }]) {
    expect(rewriteDropPlan([busy], busy.id, payload)).toEqual({ kind: 'reject', message: '这张卡正在生成，请等生成结束后再放图片。' });
  }
});

it('空白、普通图片、视频和声音卡仍走新建；不存在的目标也走新建', () => {
  const nodes: CardNode[] = [target, { ...target, id: 'ordinary', data: newCard('generate', 2) },
    { ...target, id: 'video', data: { ...newVideoCard('generate', 3), rewriteId: 'r' } },
    { ...target, id: 'audio', data: newAudioCard('work', 4) }];
  for (const id of [null, 'ordinary', 'video', 'audio', 'removed']) {
    expect(rewriteDropPlan(nodes, id, { work: image, files: [] })).toEqual({ kind: 'new' });
  }
});

it('作品库图片带可在受保护拖动阶段读取的类型标记，视频和声音不带', () => {
  for (const kind of ['image', 'video', 'audio'] as const) {
    const writes: Record<string, string> = {};
    const work = { id: 'w', kind, createdAt: '', canvasId: null, prompt: '', model: '', yuan: 0,
      width: 64, height: 32, duration: 2, format: 'wav' as const, contentType: 'audio/wav' as const,
      channels: 1, sampleRate: 44100, bitsPerSample: 16 as const, bytes: 100 };
    const tree = WorksGrid({ works: [work], onOpen: () => {}, draggable: true });
    tree.props.children[0].props.onDragStart({ dataTransfer: { setData: (type: string, value: string) => { writes[type] = value; } } });
    expect(JSON.parse(writes[WORK_DRAG_TYPE])).toMatchObject({ id: 'w', kind });
    expect(Object.keys(writes).includes(WORK_IMAGE_DRAG_TYPE)).toBe(kind === 'image');
    expect(rewriteDropHighlight([target], target.id, { types: Object.keys(writes), items: [] })).toBe(kind === 'image' ? target.id : null);
  }
});

it('拖动途中只高亮可接收目标，离开、取消或松手（无目标/无媒体）清除', () => {
  const imagePreview = { types: ['Files'], items: [{ kind: 'file', type: 'image/png' }] };
  expect(rewriteDropHighlight([target], target.id, imagePreview)).toBe(target.id);
  expect(rewriteDropHighlight([target], null, imagePreview)).toBeNull();
  expect(rewriteDropHighlight([target], target.id, { types: [], items: [] })).toBeNull();
  expect(rewriteDropHighlight([{ ...target, data: { ...target.data, jobs: ['job'] } }], target.id, imagePreview)).toBeNull();
  expect(rewriteDropHighlight([{ ...target, data: newCard('generate', 1) }], target.id, imagePreview)).toBeNull();
  for (const type of ['video/mp4', 'audio/wav', 'text/plain', '']) {
    expect(rewriteDropHighlight([target], target.id, { types: ['Files'], items: [{ kind: 'file', type }, ...imagePreview.items] })).toBeNull();
  }
});
