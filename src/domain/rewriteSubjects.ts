/**
 * 11-10 用户要：「你想换什么」右边三个常用项，点一下把字拼进原话，不用打字。
 * 衣服写「每套衣服」：拆解按套列衣服（同一时段的上衣、裤子、鞋算一套），原片换装时说「每套」才是全换。
 */
export const REWRITE_SUBJECTS = [
  { label: '人物', words: '人物' },
  { label: '衣服', words: '每套衣服' },
  { label: '背景', words: '背景' }
] as const;
export type RewriteSubject = (typeof REWRITE_SUBJECTS)[number];

const TAIL = '换成我的';
const known: readonly string[] = REWRITE_SUBJECTS.map(subject => subject.words);
const joined = (parts: string[]) => parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join('、')}和${parts[parts.length - 1]}`;

/** 空的出「X换成我的」；还是点出来的那句就拼进去（按人物、衣服、背景排）；写过的不重复；自己写的话不动，加在后面。 */
export function addRewriteSubject(text: string, subject: RewriteSubject): string {
  const current = text.trim();
  if (!current) return subject.words + TAIL;
  if (current.includes(subject.label)) return text;
  const parts = current.endsWith(TAIL) ? current.slice(0, -TAIL.length).split(/[、和]/) : [];
  if (parts.length && parts.every(part => known.includes(part))) {
    return joined([...parts, subject.words].sort((a, b) => known.indexOf(a) - known.indexOf(b))) + TAIL;
  }
  return `${current.replace(/[，,。.；;、\s]+$/, '')}，${subject.words}${TAIL}`;
}
