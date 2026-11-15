import { expect, it } from 'vitest';
import { addRewriteSubject, REWRITE_SUBJECTS } from './rewriteSubjects';

const [person, clothes, background] = REWRITE_SUBJECTS;

it('三个常用项：人物、衣服、背景；衣服写「每套衣服」（拆解按套列，原片换装时每套都换）', () => {
  expect(REWRITE_SUBJECTS.map(subject => subject.label)).toEqual(['人物', '衣服', '背景']);
  expect(clothes.words).toBe('每套衣服');
});

it('空的直接出一句；接着点就拼进同一句，按人物、衣服、背景排', () => {
  expect(addRewriteSubject('', person)).toBe('人物换成我的');
  expect(addRewriteSubject('  ', background)).toBe('背景换成我的');
  expect(addRewriteSubject('人物换成我的', clothes)).toBe('人物和每套衣服换成我的');
  expect(addRewriteSubject('背景换成我的', person)).toBe('人物和背景换成我的');
  expect(addRewriteSubject('人物和每套衣服换成我的', background)).toBe('人物、每套衣服和背景换成我的');
});

it('已经写过的不重复加；自己写的话不动原文，加在后面', () => {
  expect(addRewriteSubject('人物和每套衣服换成我的', clothes)).toBe('人物和每套衣服换成我的');
  expect(addRewriteSubject('把背景换掉', background)).toBe('把背景换掉');
  expect(addRewriteSubject('衣服换成红色的', clothes)).toBe('衣服换成红色的');
  expect(addRewriteSubject('换个发型。', person)).toBe('换个发型，人物换成我的');
  expect(addRewriteSubject('把主角换成我的', background)).toBe('把主角换成我的，背景换成我的');
});
