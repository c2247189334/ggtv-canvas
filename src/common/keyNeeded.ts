import { api } from '@/api';
import type { Health } from '@/types';

/**
 * 11-17 用户定：没填火山 Key 点发送要弹框（原来只有面板里一行红字，新手看不到），
 * 框里一个按钮直接打开右上角「设置」。出图、出视频、图层拆分 / 重绘、生成人物交单前都先过这里。
 */
export const KEY_NEEDED_TEXT = '还没填火山 Key，这单没发出去：点右上角「设置」填好再发，不用重启。';

let asking = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const subscribeKeyNeeded = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const keyNeededOpen = () => asking;
export const closeKeyNeeded = () => { asking = false; emit(); };

/** 明确没填才弹框并返回 true；假模式不挡，体检里没带这一项也不挡（小服务会兜底拦）。 */
export function askIfKeyMissing(health: Pick<Health, 'fake' | 'keyReady'>): boolean {
  if (health.fake || health.keyReady !== false) return false;
  asking = true;
  emit();
  return true;
}

/** 读体检再判断；体检读不到就放行，让小服务兜底拦（它会报同样的原因）。 */
export async function keyReadyOrAsk(read: () => Promise<Health> = api.health): Promise<boolean> {
  let health: Health;
  try { health = await read(); } catch { return true; }
  return !askIfKeyMissing(health);
}

/** 小服务拦下来说「还没填火山 Key…」的报错：弹同一个框并返回 true；别的报错不管。 */
export function askIfKeyError(error: unknown): boolean {
  if (!(error instanceof Error) || !error.message.startsWith('还没填火山 Key')) return false;
  asking = true;
  emit();
  return true;
}

/** 交单前调：没填就弹框并抛人话（面板上照样留一行字），不发请求、不花钱。 */
export async function requireKey(read: () => Promise<Health> = api.health): Promise<void> {
  if (!(await keyReadyOrAsk(read))) throw new Error(KEY_NEEDED_TEXT);
}

// 「去填 Key」按钮和右上角「设置」之间的小广播：谁都能叫设置面板打开。
const settingsListeners = new Set<() => void>();
export const subscribeOpenSettings = (listener: () => void) => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener); }; };
export const openSettings = () => settingsListeners.forEach(listener => listener());
