import type { RewriteItem, RewriteItemKind, RewritePlan, RewriteStatus } from '@/videoRewriteTypes';
import type { MotionReference } from './motionReference';

/** 旧存档没有动作参考种类时沿用深度。 */
export const readRewriteMotionReference = (raw: unknown): MotionReference => raw === 'mesh' ? 'mesh' : 'depth';

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const kinds: RewriteItemKind[] = ['人物', '衣服', '场景', '道具', '遮挡物', '其他'];

export function readRewriteItem(raw: unknown): RewriteItem | undefined {
  const item = object(raw);
  if (!item || typeof item.id !== 'string' || !item.id || !kinds.includes(item.kind as RewriteItemKind) || typeof item.desc !== 'string' ||
    !finite(item.from) || !finite(item.to) || item.to < item.from || !finite(item.frame)) return undefined;
  return { id: item.id, kind: item.kind as RewriteItemKind, desc: item.desc, from: item.from, to: item.to, frame: item.frame };
}

export function readRewriteStatus(raw: unknown): RewriteStatus | undefined {
  const value = object(raw);
  if (value?.status === 'pending' || value?.status === 'interrupted') return { status: 'interrupted' };
  if (value?.status !== 'failed' || typeof value.error !== 'string') return undefined;
  return { status: 'failed', error: value.error, yuan: finite(value.yuan) ? value.yuan : 0,
    costUnknown: value.costUnknown === true || !finite(value.yuan) };
}

export function readRewriteChangeSeconds(raw: unknown, duration: number): number[] | undefined {
  return Array.isArray(raw) ? raw.filter((value): value is number => finite(value) && value < duration) : undefined;
}

/** 存档中的拆解单重新检查并复制，只保留写词需要的结构。旧卡没有单子就省略。 */
export function readRewritePlan(raw: unknown): RewritePlan | undefined {
  const plan = object(raw);
  if (!plan || typeof plan.summary !== 'string' || !plan.summary.trim()) return undefined;
  if (!['items', 'changes', 'actions', 'replace', 'unsure'].every(key => Array.isArray(plan[key]))) return undefined;
  const rows = plan.items as unknown[];
  if (!rows.length || rows.length > 100) return undefined;
  const items = rows.map(readRewriteItem);
  if (items.some(item => !item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) || item.to <= item.from || item.frame < item.from || item.frame > item.to)) return undefined;
  const validItems = items as RewriteItem[];
  const ids = new Set(validItems.map(item => item.id));
  const replace = plan.replace as unknown[];
  if (ids.size !== items.length || new Set(replace).size !== replace.length || !replace.every(id => typeof id === 'string' && ids.has(id))) return undefined;
  const changes = (plan.changes as unknown[]).map(object), actions = (plan.actions as unknown[]).map(object);
  if (changes.length > 100 || changes.some(row => !row || !finite(row.second) || typeof row.how !== 'string')) return undefined;
  if (actions.length > 100 || actions.some(row => !row || !finite(row.from) || !finite(row.to) || row.to <= row.from || typeof row.desc !== 'string')) return undefined;
  const unsure = plan.unsure as unknown[];
  if (!unsure.every(value => typeof value === 'string')) return undefined;
  return { summary: plan.summary, items: validItems, replace: [...replace] as string[],
    changes: changes.map(row => ({ second: row!.second as number, how: row!.how as string })),
    actions: actions.map(row => ({ from: row!.from as number, to: row!.to as number, desc: row!.desc as string })),
    unsure: [...unsure] as string[] };
}
