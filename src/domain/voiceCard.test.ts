// 11-19 第二期「人物带声音」页面这边：声音卡能不能存、嗓音描述检查、人物拖进说话版铺声音卡、交提示词的用途、存档读回、删作品提醒。
import { expect, it } from 'vitest';
import { newAudioCard, newCard, newVideoCard } from './cards';
import { readCard } from './canvasDoc';
import { workDeleteText } from './characters';
import { videoRewriteMaterials } from './videoRewrite';
import { voiceDescProblem, voiceDropPlan, voicePurpose, voiceSaveSource } from './voiceCard';
import type { CardData, CardNode } from '@/types';
import type { CharacterView } from '@/characterTypes';

const node = (id: string, data: CardData, x = 0, y = 0): CardNode => ({ id, type: 'card', data, position: { x, y } });
const voice = { ref: { type: 'work' as const, id: 'v1' }, desc: '清亮的年轻男声', seconds: 6 };
const character: Pick<CharacterView, 'name' | 'voice'> = { name: '阿青', voice };
const person = node('p', { ...newCard('generate', 2), rewriteId: 'r', rewriteItemId: 'P1',
  rewriteItem: { id: 'P1', kind: '人物' as const, desc: '女生', from: 0, to: 8, frame: 0 } }, 600, 400);
const talking = (extra = {}) => node('v', { ...newVideoCard('generate', 3), rewriteId: 'r', rewriteTalking: true as const, ...extra }, 1000, 0);
const edges = [{ source: 'p', target: 'v' }];

it('存为人物的声音：只认有声音作品的声音卡，2～15 秒；嗓音描述要写、不超 200 字、不许有花括号', () => {
  expect(voiceSaveSource(node('a', newAudioCard('extracted', 1, [{ type: 'work', id: 'w', media: 'audio', seconds: 6 }])))).toEqual({ ref: { type: 'work', id: 'w', media: 'audio', seconds: 6 } });
  expect(voiceSaveSource(node('i', newCard('generate', 1)))).toEqual({ problem: '选一张声音卡才能存为人物的声音。' });
  expect(voiceSaveSource(node('a', newAudioCard('extracted', 1)))).toEqual({ problem: '这张声音卡还没有声音。' });
  expect('problem' in voiceSaveSource(node('a', newAudioCard('extracted', 1, [{ type: 'work', id: 'w', media: 'audio', seconds: 20 }])))).toBe(true);
  expect(voiceDescProblem(' ')).toMatch(/写一句嗓音描述/);
  expect(voiceDescProblem('男'.repeat(201))).toMatch(/200/);
  expect(voiceDescProblem('男声{你好}')).toMatch(/\{ \}/);
  expect(voiceDescProblem('男声')).toBeNull();
});

it('人物拖到说话版的人物卡上：新铺一张声音卡（在视频卡下面、不占编号）连到视频卡，声音栏空着就填人物那句', () => {
  const nodes = [person, talking()];
  const plan = voiceDropPlan(nodes, edges, 'p', character, () => 'a1')!;
  expect(plan).toMatchObject({ videoId: 'v', voiceText: '清亮的年轻男声', edge: { id: 'link:a1>v', source: 'a1', target: 'v' } });
  expect(plan.node!.data).toMatchObject({ kind: 'audio', source: 'work', number: 0, title: '阿青 · 声音', voiceOf: '阿青',
    results: [{ type: 'work', id: 'v1', media: 'audio', seconds: 6 }] });
  expect(plan.node!.position.x).toBe(1000); expect(plan.node!.position.y).toBeGreaterThan(0);
  // 交提示词：这张声音卡用途是音色，原声卡照旧是背景音乐。
  const withVoice = [...nodes, plan.node!];
  expect(videoRewriteMaterials(withVoice, [...edges, plan.edge!], 'v').find(material => material.tag === '@音频1')?.purpose).toBe(voicePurpose('阿青'));
  const music = node('m', newAudioCard('extracted', 4, [{ type: 'work', id: 'w', media: 'audio', seconds: 8 }]));
  expect(videoRewriteMaterials([...nodes, music], [...edges, { source: 'm', target: 'v' }], 'v').find(material => material.tag === '@音频1')?.purpose).toMatch(/背景音乐/);
});

it('已经连着声音样本卡就换声音不新建；声音栏写了别的字不动、要提醒；一样的字什么都不说', () => {
  const old = node('a0', { ...newAudioCard('work', 0, [{ type: 'work', id: 'old', media: 'audio', seconds: 5 }]), voiceOf: '旧人' });
  const plan = voiceDropPlan([person, talking({ rewriteVoice: '低沉男声' }), old], [...edges, { source: 'a0', target: 'v' }], 'p', character)!;
  expect(plan).toMatchObject({ replaceId: 'a0', keptVoice: true }); expect(plan.node).toBeUndefined(); expect(plan.voiceText).toBeUndefined();
  const same = voiceDropPlan([person, talking({ rewriteVoice: '清亮的年轻男声' })], edges, 'p', character, () => 'a1')!;
  expect(same.keptVoice).toBeUndefined(); expect(same.voiceText).toBeUndefined();
});

it('不铺声音卡：人物没声音、不是说话版、落的不是人物卡', () => {
  expect(voiceDropPlan([person, talking()], edges, 'p', { name: '阿青' })).toBeNull();
  expect(voiceDropPlan([person, node('v', { ...newVideoCard('generate', 3), rewriteId: 'r' })], edges, 'p', character)).toBeNull();
  const clothes = node('c', { ...newCard('generate', 4), rewriteId: 'r', rewriteItem: { id: 'C1', kind: '衣服' as const, desc: '上衣', from: 0, to: 8, frame: 0 } });
  expect(voiceDropPlan([clothes, talking()], [{ source: 'c', target: 'v' }], 'c', character)).toBeNull();
});

it('声音样本卡存档读回带人物名字；删作品时是人物的声音要提醒', () => {
  const read = readCard({ ...newAudioCard('work', 0, [{ type: 'work', id: 'v1', media: 'audio', seconds: 6 }]), voiceOf: ' 阿青 ' });
  expect(read).toMatchObject({ kind: 'audio', voiceOf: '阿青' });
  expect(readCard({ ...newAudioCard('work', 0), voiceOf: 3 })).not.toHaveProperty('voiceOf');
  const full = { id: 'c', name: '阿青', description: '', createdAt: '', updatedAt: '', status: 'ready' as const, images: [], voice };
  expect(workDeleteText('v1', [full])).toContain('它是人物「阿青」的声音，人物会没有声音。');
  expect(workDeleteText('other', [full])).not.toContain('声音');
});
