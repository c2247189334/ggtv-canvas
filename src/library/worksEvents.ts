import { useSyncExternalStore } from "react";

/**
 * 作品库的两个小广播，省得一层层传 props：
 *   · 删掉的作品：画布上用到它的卡片立刻显示「作品已删除」（刷新以后靠图片读不出来判断，见 ImageCard）；
 *   · 作品有变化（出了新图 / 删了图）：作品库侧栏重新拉一次清单。
 */
let deleted: ReadonlySet<string> = new Set();
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markWorkDeleted(id: string): void {
  deleted = new Set(deleted).add(id);
  version += 1;
  emit();
}

export function bumpWorks(): void {
  version += 1;
  emit();
}

export function isWorkDeleted(id: string): boolean {
  return deleted.has(id);
}

export function worksVersion(): number {
  return version;
}

export function useDeletedWorks(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => deleted);
}

export function useWorksVersion(): number {
  return useSyncExternalStore(subscribe, worksVersion);
}
