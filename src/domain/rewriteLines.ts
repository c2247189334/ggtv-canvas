import type { VideoCardData } from '@/types';
import { OFF_CAMERA, type RewriteLine, type RewritePlan } from '@/videoRewriteTypes';

/** 11-19 说话版的台词表：增删改都返回新单子（存进视频卡的 rewritePlan.lines），按开始秒数排好。 */
export const MAX_LINE_TEXT = 200;
const sorted = (lines: RewriteLine[]) => [...lines].sort((a, b) => a.from - b.from || a.to - b.to);
const round = (n: number) => Math.round(n * 10) / 10;
/** 片长往下取到 0.1 秒：秒数最多到这儿。8.47 秒的片尾进成 8.5 会被小服务当成超出片长打回（11-19 上传前审查）。小服务 lines.mjs 同一份。 */
export const lastTenth = (duration: number) => Math.floor(duration * 10) / 10;
const latestStart = (duration: number) => Math.max(0, round(lastTenth(duration) - 0.1));

export function talkingLines(data: VideoCardData): RewriteLine[] {
  return data.rewriteTalking ? data.rewritePlan?.lines ?? [] : [];
}

/** 谁说：拆解认出的人物 + 镜头外。 */
export function lineSpeakers(plan: RewritePlan): Array<{ id: string; label: string }> {
  const people = plan.items.filter(item => item.kind === '人物');
  return [...people.map((item, index) => ({ id: item.id, label: people.length > 1 ? `人物 ${index + 1}` : '出镜的人' })), { id: OFF_CAMERA, label: OFF_CAMERA }];
}

/** 改一行：秒数夹在 0～时长里，结束至少比开始晚 0.1 秒；字最多 200 个，去掉大括号（写词时台词放在 {} 里）。 */
export function editLine(plan: RewritePlan, id: string, change: Partial<Omit<RewriteLine, 'id'>>, duration: number): RewritePlan {
  const lines = (plan.lines ?? []).map(line => {
    if (line.id !== id) return line;
    const next = { ...line, ...change };
    const from = Math.min(round(Math.max(0, Number(next.from) || 0)), latestStart(duration));
    const to = Math.min(lastTenth(duration), round(Math.max(from + 0.1, Number(next.to) || 0)));
    return { ...next, from, to, text: String(next.text).replace(/[{}]/g, '').replace(/[\r\n]+/g, ' ').slice(0, MAX_LINE_TEXT) };
  });
  return { ...plan, lines: change.from === undefined && change.to === undefined ? lines : sorted(lines) };
}

/** 加一行：接在最后一句后面 2 秒（到结尾就贴着结尾），谁说照最后一句。 */
export function addLine(plan: RewritePlan, duration: number): RewritePlan {
  const lines = plan.lines ?? [], last = lines.at(-1);
  const taken = new Set(lines.map(line => line.id));
  let n = lines.length + 1;
  while (taken.has(`L${n}`)) n++;
  const from = Math.min(round(Math.min(last?.to ?? 0, Math.max(0, duration - 0.5))), latestStart(duration));
  const who = last?.who ?? lineSpeakers(plan)[0].id;
  return { ...plan, lines: sorted([...lines, { id: `L${n}`, who, text: '', from, to: Math.min(lastTenth(duration), round(from + 2)) }]) };
}

export const removeLine = (plan: RewritePlan, id: string): RewritePlan => ({ ...plan, lines: (plan.lines ?? []).filter(line => line.id !== id) });

/** 生成提示词前：说话版至少一句、每句都有字（小服务也这么拦）。 */
export function talkingLinesProblem(data: VideoCardData): string | null {
  if (!data.rewriteTalking) return null;
  const lines = talkingLines(data);
  if (!lines.length) return '台词表是空的：至少写一句台词，再生成提示词';
  const empty = lines.filter(line => !line.text.trim()).length;
  return empty ? `台词表还有 ${empty} 句没填字：填好或删掉，再生成提示词` : null;
}
