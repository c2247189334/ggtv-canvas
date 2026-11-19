import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CardNode } from '@/types';
import { newCard, newVideoCard } from '@/domain/cards';
import { VideoCard } from './VideoCard';
import { ImageCard } from './ImageCard';
import { GroupFrames } from './GroupFrames';
import { RewriteProgress } from './RewriteProgress';
const state = vi.hoisted(() => ({ productInput: false, nodes: [] as CardNode[], addImage: vi.fn() }));
vi.mock('@xyflow/react', () => ({ Position: { Bottom: 'bottom', Top: 'top' }, SelectionMode: { Partial: 'partial' },
  NodeToolbar: ({ children }: { children: ReactNode }) => children, ViewportPortal: ({ children }: { children: ReactNode }) => children,
  useNodes: () => state.nodes, useKeyPress: () => false,
  useStore: (selector: (value: unknown) => unknown) => selector({ nodes: [{ selected: true }, ...state.nodes], connection: { inProgress: false }, transform: [0, 0, 1] }) }));
vi.mock('./CardHandle', () => ({ CardHandle: () => null, LineEnd: () => null }));
vi.mock('./PromptPanel', () => ({ PromptPanel: () => <span>原提示词面板</span> }));
vi.mock('./ProductInput', () => ({ ProductInput: () => <span>商品输入框</span> }));
vi.mock('./boardContext', () => ({ useBoard: () => ({ productRemake: { inputId: state.productInput ? 'v' : null, addImage: state.addImage } }) }));
vi.mock('@/library/worksEvents', () => ({ useDeletedWorks: () => new Set() }));
it('有结果原视频工具条只有「视频改写」（11-19 起无人物收进它的三选一）；输入框替代原面板', () => {
  const data = newVideoCard('generate', 1, [{ type: 'upload', id: 'result', media: 'video', seconds: 6 }]);
  const render = () => renderToStaticMarkup(<VideoCard {...({ id: 'v', data, selected: true } as NodeProps<CardNode>)} />);
  state.productInput = false; const html = render();
  expect(html).toContain('>视频改写<'); expect(html).not.toContain('拆解（无人物）');
  state.productInput = true; expect(render()).toContain('商品输入框'); expect(render()).not.toContain('原提示词面板');
});
it('空输出也有加商品/背景，背景已有则禁用；商品空卡写实物照且提示词留空', () => {
  state.productInput = false;
  const image: CardNode = { id: 'i', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 1), rewriteId: 'v',
    productRole: { role: 'background' as const, videoId: 'v' } } };
  state.nodes = [image];
  const html = renderToStaticMarkup(<VideoCard {...({ id: 'v', data: { ...newVideoCard('generate', 2), rewriteKind: 'product' }, selected: true } as NodeProps<CardNode>)} />);
  expect(html).toContain('>加商品<'); expect(html).toMatch(/disabled=""[^>]*>加背景</);
  image.data = { ...newCard('generate', 1), rewriteId: 'v', productRole: { role: 'product' as const, videoId: 'v', productId: 'A', name: '鞋子' } };
  const content = renderToStaticMarkup(<ImageCard {...({ id: image.id, data: image.data, selected: true } as NodeProps<CardNode>)} />);
  expect(content).toContain('传：鞋子的实物照（一张一个角度：正面、侧面、鞋底…）'); expect(image.data.prompt).toBe('');
});
it('商品空卡第一行写所属视频拆解单里这组原片的样子', () => {
  const plan = { products: [{ id: 'A', name: '鞋子', look: '香槟金色尖头玛丽珍鞋，方形水钻', pairs: 1, pieces: 2, layout: '' }],
    visible: '', face: false, looks: [], timeline: [], unsure: [] };
  state.nodes = [{ id: 'v', type: 'card', position: { x: 0, y: 0 }, data: { ...newVideoCard('generate', 2), rewriteKind: 'product' as const, productPlan: plan } }];
  const data = { ...newCard('generate', 1), rewriteId: 'v', productRole: { role: 'product' as const, videoId: 'v', productId: 'A', name: '鞋子' } };
  const html = renderToStaticMarkup(<ImageCard {...({ id: 'i', data, selected: true } as NodeProps<CardNode>)} />);
  expect(html).toContain('>原片里这组：香槟金色尖头玛丽珍鞋\n传：要换成的鞋子实物照（一张一个角度：正面、侧面、鞋底…）<');
  state.nodes = [];
});
it('商品组工具条解组旁有加一张，点了带组id；普通组不增加按钮', () => {
  const node: CardNode = { id: 'i', type: 'card', position: { x: 0, y: 0 }, data: { ...newCard('generate', 1), group: { id: 'g', name: '商品A', productId: 'A', videoId: 'v' } } };
  const props = { nodes: [node], selected: 'g', onPointerDown: vi.fn(), onContextMenu: vi.fn(), onUngroup: vi.fn(), onAddImage: state.addImage };
  const html = renderToStaticMarkup(<GroupFrames {...props} />); expect(html).toContain('>加一张<');
  const tools = GroupFrames(props).props.children.at(-1);
  tools.props.children[1].props.onClick(); expect(state.addImage).toHaveBeenCalledWith('g');
  node.data.group = { id: 'g', name: 'Group 1' }; expect(renderToStaticMarkup(<GroupFrames {...props} />)).not.toContain('>加一张<');
});
it('商品拆解中断后指引点视频改写、选不露脸那种，普通视频改写指引保持原文', () => {
  const data = { ...newVideoCard('upload', 0), rewriteStatus: { status: 'interrupted' as const } };
  expect(renderToStaticMarkup(<RewriteProgress data={{ ...data, rewriteTask: 'product' }} />)).toContain('再点一次「视频改写」选「不露脸 · 声音按原视频」重来');
  expect(renderToStaticMarkup(<RewriteProgress data={data} />)).toContain('再点一次「视频改写」重来');
});
