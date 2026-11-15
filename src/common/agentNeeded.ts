import { api } from '@/api';
import type { Health } from '@/types';

/**
 * 拆解、生成提示词、帮我改写都要本机 agent（11-15 用户定，不再用豆包）。
 * 点这些按钮时先读一次体检，没配好就弹说明框（AgentNeededDialog），不发请求、不建卡、不花钱。
 */
let problem: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

export const subscribeAgentNeeded = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const agentNeededProblem = () => problem;
export const closeAgentNeeded = () => { problem = null; emit(); };

/** 没配好就弹框并返回 true；假模式不挡（和其他开跑预检一样）。 */
export function askIfAgentMissing(health: Pick<Health, 'fake' | 'agentReady' | 'agentProblem'>): boolean {
  if (health.fake || health.agentReady) return false;
  problem = health.agentProblem || '本机 Claude 或 Codex 没配好。';
  emit();
  return true;
}

/** 读体检再判断；体检读不到就放行，让小服务兜底拦（它会报同样的原因）。 */
export async function agentReadyOrAsk(read: () => Promise<Health> = api.health): Promise<boolean> {
  let health: Health;
  try { health = await read(); } catch { return true; }
  return !askIfAgentMissing(health);
}
