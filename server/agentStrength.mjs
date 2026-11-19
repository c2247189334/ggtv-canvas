// 设置面板「写词强度」三档（11-19 用户定）：标准 = sonnet；更强 = opus + 中等强度；最强 = opus + XHigh。
// 存进 .env.local 的 CLAUDE_MODEL、CLAUDE_EFFORT；手填成别的组合就算「自定义」，页面哪档都不勾。
// 只管本机 Claude：Codex 认不认强度参数 11-19 没法实测（当时没登录），先不动它。
import { CLAUDE_DEFAULT_MODEL, claudeEffortOf } from './claude.mjs';
import { configured } from './config.mjs';

export const STRENGTHS = Object.freeze({
  standard: Object.freeze({ model: 'sonnet', effort: '' }),
  strong: Object.freeze({ model: 'opus', effort: 'medium' }),
  max: Object.freeze({ model: 'opus', effort: 'xhigh' }),
});
export const CUSTOM = 'custom';

/** 现在是哪一档；对不上任何一档回 custom。 */
export function strengthOf(env) {
  const model = (configured(env, 'CLAUDE_MODEL') || CLAUDE_DEFAULT_MODEL).toLowerCase(), effort = claudeEffortOf(env);
  return Object.keys(STRENGTHS).find(id => STRENGTHS[id].model === model && STRENGTHS[id].effort === effort) ?? CUSTOM;
}

/** 某一档要写进 .env.local 的两项；不认识的档回 null。 */
export function strengthValues(id) {
  if (!Object.hasOwn(STRENGTHS, id)) return null;
  const { model, effort } = STRENGTHS[id];
  return { CLAUDE_MODEL: model, CLAUDE_EFFORT: effort };
}
