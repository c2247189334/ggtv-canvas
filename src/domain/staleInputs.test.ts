import { expect, it } from 'vitest';
import { newCard, newVideoCard } from './cards';
import { inputChanges, sentInputsOf, staleNote } from './staleInputs';
import type { CardNode } from '@/types';

const node = (id: string, data: CardNode['data']): CardNode => ({ id, type: 'card', position: { x: 0, y: 0 }, data });
const edge = (source: string, target: string) => ({ id: `${source}-${target}`, source, target });
const image = (id: string, result: string) => node(id, { ...newCard('upload', 0, [{ type: 'upload', id: result }]) });

it('发送时记下按连线顺序每张参考当前那张和提示词（去掉首尾空白）', () => {
  const output = node('v', { ...newVideoCard('generate', 3), prompt: ' 跳舞 ' });
  const nodes = [image('a', 'u1'), image('b', 'u2'), output];
  expect(sentInputsOf(nodes, [edge('a', 'v'), edge('b', 'v')], 'v')).toEqual({ refs: ['upload:u1', 'upload:u2'], prompt: '跳舞' });
  const empty = node('c', newCard('generate', 4));
  expect(sentInputsOf([empty, output], [edge('c', 'v')], 'v').refs).toEqual(['none']);
});

it('列出变了什么：提示词、第几个参考换了、多连 / 少连；没记过就不算变', () => {
  const sent = { refs: ['upload:u1', 'upload:u2'], prompt: '跳舞' };
  expect(inputChanges(sent, sent)).toEqual([]);
  expect(inputChanges(undefined, { refs: ['upload:x'], prompt: '别的' })).toEqual([]);
  expect(inputChanges(sent, { refs: ['upload:u1', 'work:w9'], prompt: '跳舞' })).toEqual(['第 2 个参考换了']);
  expect(inputChanges(sent, { refs: ['upload:u1', 'upload:u2', 'upload:u3'], prompt: '唱歌' })).toEqual(['提示词改过', '多连了 1 个参考']);
  expect(inputChanges(sent, { refs: ['work:w1'], prompt: '跳舞' })).toEqual(['第 1 个参考换了', '少了 1 个参考']);
});

it('只在生成卡有结果、没在生成时亮「输入已更新」，上游换图就亮', () => {
  const sentInputs = { refs: ['upload:u1'], prompt: '跳舞' };
  const done = node('v', { ...newVideoCard('generate', 3, [{ type: 'work', id: 'w1', media: 'video' }]), prompt: '跳舞', sentInputs });
  const edges = [edge('a', 'v')];
  expect(staleNote([image('a', 'u1'), done], edges, 'v')).toBe('');
  expect(staleNote([image('a', 'u9'), done], edges, 'v')).toBe('第 1 个参考换了');
  const busy = node('v', { ...done.data, jobs: ['j1'] });
  expect(staleNote([image('a', 'u9'), busy], edges, 'v')).toBe('');
  const noResult = node('v', { ...done.data, results: [] });
  expect(staleNote([image('a', 'u9'), noResult], edges, 'v')).toBe('');
  const upload = node('v', { ...done.data, source: 'upload' });
  expect(staleNote([image('a', 'u9'), upload], edges, 'v')).toBe('');
});
