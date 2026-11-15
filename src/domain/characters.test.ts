import { expect, it } from 'vitest';
import { characterVideoText, characterFieldsProblem, characterDeleteText, characterDescriptionProblem } from './characters';

it('每种视频状态使用设计原话，可信图显示剩余天数', () => {
  expect(characterVideoText({ status: 'asset' })).toBe('给视频用素材编号');
  expect(characterVideoText({ status: 'trusted', days: 30 })).toBe('视频可用 · 剩 30 天');
  expect(characterVideoText({ status: 'trusted', days: 1 })).toBe('视频可用 · 剩 1 天');
  expect(characterVideoText({ status: 'expired' })).toBe('已过 30 天，给视频会被拦');
  expect(characterVideoText({ status: 'edited' })).toBe('改出来的图，给视频会被拦，只能出图用');
  expect(characterVideoText({ status: 'photo' })).toBe('电脑传的图，有真人脸给视频要填素材编号');
});

it('人物名字和描述边界按字数检查', () => {
  expect(characterFieldsProblem('  ', '')).toContain('名字');
  expect(characterFieldsProblem('人'.repeat(41), '')).toContain('40');
  expect(characterFieldsProblem('人', '字'.repeat(501))).toContain('500');
  expect(characterFieldsProblem('😀'.repeat(40), '字'.repeat(500))).toBeNull();
  expect(characterFieldsProblem('人', '描述')).toBeNull();
  expect(characterDeleteText('阿青')).toBe('删掉人物「阿青」？画布上已经放好的不受影响，图还在作品库里。');
  expect(characterDescriptionProblem('')).toContain('1～500');
  expect(characterDescriptionProblem('字'.repeat(501))).toContain('500');
  expect(characterDescriptionProblem('😀'.repeat(500))).toBeNull();
});
