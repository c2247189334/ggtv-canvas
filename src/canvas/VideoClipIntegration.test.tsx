import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { CardNode } from '@/types';
import { newVideoCard } from '@/domain/cards';
import { VideoCard } from './VideoCard';

const state = vi.hoisted(() => ({ clip: false, input: false }));
vi.mock('@xyflow/react', () => ({ Position: { Bottom: 'bottom', Top: 'top' }, SelectionMode: { Partial: 'partial' },
  NodeToolbar: ({ children }: { children: ReactNode }) => children,
  useStore: (selector: (value: unknown) => unknown) => selector({ nodes: [{ selected: true }], connection: { inProgress: false } }) }));
vi.mock('./CardHandle', () => ({ CardHandle: () => null, LineEnd: () => <span>来源接点</span> }));
vi.mock('./PromptPanel', () => ({ PromptPanel: () => <span>原提示词面板</span> }));
vi.mock('./RewriteInput', () => ({ RewriteInput: () => <span>视频改写输入框</span> }));
vi.mock('./VideoClipBar', () => ({ VideoClipBar: () => <span>剪辑条</span> }));
vi.mock('./boardContext', () => ({ useBoard: () => ({ videoClip: { session: state.clip ? { cardId: 'v', asset: { type: 'upload', id: 'pinned', media: 'video', seconds: 9 } } : null }, videoRewrite: { inputId: state.input ? 'v' : null } }) }));
vi.mock('@/library/worksEvents', () => ({ useDeletedWorks: () => new Set() }));

const render = (upload = false, pages = false) => renderToStaticMarkup(<VideoCard {...({ id: 'v', selected: true,
  data: { ...newVideoCard(upload ? 'upload' : 'generate', 0, [{ type: 'upload', id: 'v', media: 'video', seconds: 9 },
    ...(pages ? [{ type: 'upload' as const, id: 'new-result', media: 'video' as const, seconds: 12 }] : [])]),
    ...(upload ? { mediaSource: { type: 'upload', id: 'original', media: 'video' } } : {}) } } as NodeProps<CardNode>)} />);
it('打开剪辑条隐藏工具条、提示词和改写框，退出后恢复', () => {
  state.clip = false; state.input = false;
  expect(render()).toContain('原提示词面板'); expect(render()).toContain('card-tools');
  state.clip = true;
  expect(render()).toContain('剪辑条'); expect(render()).not.toContain('card-tools'); expect(render()).not.toContain('原提示词面板');
  state.input = true;
  expect(render()).not.toContain('视频改写输入框');
  state.clip = false;
  expect(render()).toContain('视频改写输入框'); expect(render()).toContain('card-tools');
});
it('剪辑期间禁止翻页，后台新增结果也继续用会话原视频预览，关掉后恢复', () => {
  state.clip = true; state.input = false;
  const html = render(false, true);
  expect(html).toContain('src="/api/uploads/file?id=pinned#t=0.001"');
  expect(html).toMatch(/aria-label="下一段" disabled=""/);
  state.clip = false;
  expect(render(false, true)).toContain('src="/api/uploads/file?id=v#t=0.001"');
  expect(render(false, true)).not.toMatch(/aria-label="下一段" disabled=""/);
});
it('剪辑上传卡使用看不见的来源接点，右侧仍能拖参考线，上方功能保持完整', () => {
  state.clip = false; state.input = false;
  const html = render(true);
  expect(html).toContain('来源接点'); expect(html).toContain('片段截取'); expect(html).toContain('视频改写');
  expect(html).toContain('提取原声'); expect(html).toContain('深度动作捕捉');
});
it('视频仍在生成时显示网络查询提示，并保留忙态', () => {
  state.clip = false; state.input = false;
  const html = renderToStaticMarkup(<VideoCard {...({ id: 'v', selected: true,
    data: { ...newVideoCard('generate', 1), jobs: ['j'], phase: 'waiting',
      jobWarning: '暂时查不到火山的结果，网络恢复后会自动接着查。' } } as NodeProps<CardNode>)} />);
  expect(html).toContain('暂时查不到火山的结果，网络恢复后会自动接着查。');
  expect(html).toContain('busy-spinner');
});
