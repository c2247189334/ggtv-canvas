import type { CharacterVideo, CharacterView } from '@/characterTypes';

export function characterVideoText(video: CharacterVideo): string {
  if (video.status === 'trusted') return `视频可用 · 剩 ${video.days ?? 0} 天`;
  const text = {
    asset: '给视频用素材编号',
    expired: '已过 30 天，给视频会被拦',
    edited: '改出来的图，给视频会被拦，只能出图用',
    photo: '电脑传的图，有真人脸给视频要填素材编号'
  };
  return text[video.status];
}

export function characterFieldsProblem(name: string, description: string): string | null {
  const length = [...name.trim()].length;
  if (!length || length > 40) return '人物名字要在 1～40 个字之间。';
  if ([...description.trim()].length > 500) return '人物描述最多 500 个字。';
  return null;
}

export function characterDescriptionProblem(description: string): string | null {
  const length = [...description.trim()].length;
  return length < 1 || length > 500 ? '人物描述要在 1～500 个字之间。' : null;
}

export function characterDeleteText(name: string): string {
  return `删掉人物「${name}」？画布上已经放好的不受影响，图还在作品库里。`;
}

export function workDeleteText(workId: string, characters: readonly CharacterView[]): string {
  const base = '删掉这件作品？硬盘上的文件会一起删掉，画布上用到它的卡片会显示「作品已删除」。';
  const owners = characters.filter(character => character.images.some(image => image.ref.type === 'work' && image.ref.id === workId));
  // 11-19 第二期：是人物的声音样本也提醒一句。
  const voices = characters.filter(character => character.voice?.ref.id === workId);
  return base + owners.map(character => `它是人物「${character.name}」的图，人物里也会少这张。`).join('')
    + voices.map(character => `它是人物「${character.name}」的声音，人物会没有声音。`).join('');
}
