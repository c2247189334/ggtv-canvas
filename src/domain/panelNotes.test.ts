import { expect, it } from 'vitest';
import { mergeTagIssues } from './panelNotes';

it('只差素材编号的同一句合成一句，编号按出现顺序用顿号连', () => {
  const duty = (tag: string) => `${tag}的素材职责要放在时间轴前，请在第一个时间区间前写明它采用什么、不采用什么。`;
  expect(mergeTagIssues([duty('@图片1'), duty('@图片2'), '时间轴中间断开', duty('@视频1')])).toEqual([
    '@图片1、@图片2、@视频1的素材职责要放在时间轴前，请在第一个时间区间前写明它采用什么、不采用什么。', '时间轴中间断开'
  ]);
  const missing = (tag: string) => `提示词没有提到素材 ${tag}，请补上编号和用途。`;
  expect(mergeTagIssues([missing('@音频1'), missing('@图片3')])).toEqual(['提示词没有提到素材 @音频1、@图片3，请补上编号和用途。']);
});

it('引号里的原话不同就不合并；一句里有两个编号、没有编号、完全重复的照原样（重复只留一句）', () => {
  const quote = ['@图片1还写着原视频的原描述「金色长发」，请删掉这段。', '@图片2还写着原视频的原描述「红裙」，请删掉这段。'];
  expect(mergeTagIssues(quote)).toEqual(quote);
  expect(mergeTagIssues(['@图片1和@图片2对不上', '@图片3和@图片4对不上'])).toEqual(['@图片1和@图片2对不上', '@图片3和@图片4对不上']);
  expect(mergeTagIssues(['时间轴中间断开', '时间轴中间断开'])).toEqual(['时间轴中间断开']);
  expect(mergeTagIssues([])).toEqual([]);
});
