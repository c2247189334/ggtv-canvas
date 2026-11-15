import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newCard, newVideoCard } from '@/domain/cards';
import type { CardNode } from '@/types';
import { CardHead } from './CardHead';

const graph = vi.hoisted(() => ({ nodes: [] as unknown[], edges: [] as unknown[] }));
vi.mock('@xyflow/react', () => ({ useStore: (selector: (state: unknown) => unknown) => selector(graph) }));

const node = (id: string, data: CardNode['data']): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data });

it('标题行：标题悬停看全名，右边分辨率；上游换图后亮「输入已更新」并写变了什么', () => {
  const output = node('v', { ...newVideoCard('generate', 3, [{ type: 'work', id: 'w1', media: 'video' }]), prompt: '跳舞',
    sentInputs: { refs: ['upload:u1'], prompt: '跳舞' } });
  graph.edges = [{ id: 'a-v', source: 'a', target: 'v' }];
  graph.nodes = [node('a', newCard('upload', 0, [{ type: 'upload', id: 'u1' }])), output];
  const fresh = renderToStaticMarkup(<CardHead id="v" title="视频 3" size={{ width: 1280, height: 720 }} />);
  expect(fresh).toContain('title="视频 3"');
  expect(fresh).toContain('1280 × 720');
  expect(fresh).not.toContain('输入已更新');
  graph.nodes = [node('a', newCard('upload', 0, [{ type: 'upload', id: 'u2' }])), output];
  const stale = renderToStaticMarkup(<CardHead id="v" title="视频 3" />);
  expect(stale).toMatch(/title="上次生成后：第 1 个参考换了"[^>]*>输入已更新</);
  expect(stale).not.toContain('×');
});
