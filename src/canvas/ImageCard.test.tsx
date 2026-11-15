import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CardNode } from '@/types';
import { newCard } from '@/domain/cards';
import { ImageCard } from './ImageCard';

vi.mock('@xyflow/react', () => ({ Position: { Bottom: 'bottom', Top: 'top' }, SelectionMode: { Partial: 'partial' }, NodeToolbar: ({ children }: { children: ReactNode }) => children,
  useStore: (selector: (value: unknown) => unknown) => selector({ nodes: [], connection: { inProgress: false } }) }));
vi.mock('./CardHandle', () => ({ CardHandle: () => null, LineEnd: () => <span>line-end</span> }));
vi.mock('./boardContext', () => ({ useBoard: () => ({}) }));
vi.mock('@/canvas/boardContext', () => ({ useBoard: () => ({}) }));
vi.mock('@/library/worksEvents', () => ({ useDeletedWorks: () => new Set() }));

const render = (data: CardNode['data']) => renderToStaticMarkup(<ImageCard {...({ id: 'i', data, selected: false } as NodeProps<CardNode>)} />);

it('从视频截出来的图片卡有看不见的左接点，来源线才画得出来；普通上传图没有', () => {
  const shot = { ...newCard('upload', 0, [{ type: 'upload' as const, id: 'frame' }]), title: '首帧',
    mediaSource: { type: 'upload' as const, id: 'clip', media: 'video' as const } };
  expect(render(shot)).toContain('line-end');
  expect(render(newCard('upload', 0, [{ type: 'upload', id: 'photo' }]))).not.toContain('line-end');
});

it('11-11 改写卡还没图时按 emptyAspect 画框（和左边原片截图一样大）；没这个字段照旧', () => {
  // 生成卡带提示词面板（要画布库的连线钩子），这里用没图的上传卡验框子，判断不分卡种。
  const slot = { ...newCard('upload', 0), emptyAspect: 0.5 };
  expect(render(slot)).toContain('aspect-ratio:0.5');
  expect(render(slot)).toContain('card__body--fit');
  expect(render(newCard('upload', 0))).not.toContain('aspect-ratio');
});
