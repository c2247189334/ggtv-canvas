const TAG = /@(?:图片|图像|视频|音频)\d+/g;
const SLOT = '\u0000';

/**
 * 面板提醒里只差一个素材编号的同一句合成一句（11-08 用户定：改写卡一次报十几条「@图片N 的素材职责…」，把发送挤出屏）。
 * 一句里没有编号或有两个以上编号、引号里原话不同的照原样；完全一样的只留一句。顺序按第一次出现。
 */
export function mergeTagIssues(list: readonly string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const issue of list) {
    const tags = issue.match(TAG) ?? [];
    const key = tags.length === 1 ? issue.replace(tags[0], SLOT) : issue;
    const group = groups.get(key) ?? [];
    if (tags.length === 1 && !group.includes(tags[0])) group.push(tags[0]);
    groups.set(key, group);
  }
  return [...groups].map(([key, tags]) => key.includes(SLOT) ? key.replace(SLOT, tags.join('、')) : key);
}
