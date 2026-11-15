/**
 * 存档冲突登记：某张画布在别的页面被改过（小服务回 409）之后，这一页就不再保存它。
 * 记在模块里：同一页切走再切回来也不解除，刷新页面才重新算。常驻提醒（SaveConflictBanner）订阅它。
 */
const conflicted = new Set<string>();
const listeners = new Set<() => void>();

export const hasSaveConflict = (canvasId: string) => conflicted.has(canvasId);

export function markSaveConflict(canvasId: string) {
  if (conflicted.has(canvasId)) return;
  conflicted.add(canvasId);
  for (const listener of [...listeners]) listener();
}

export function subscribeSaveConflicts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
