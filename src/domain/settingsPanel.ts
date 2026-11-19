import { featureChecklist } from "@/domain/featureChecklist";
import type { Health } from "@/types";

/**
 * 右上角「设置」面板（11-19 用户定：一个面板里全搞定，不再点一项弹一个窗口）：功能 / 火山 Key / 本机 AI 助手三块。
 * 这里只算每块显示什么字；怎么画在 src/shell/SettingsPanel.tsx。
 */

/** 写词强度三档的说法，和小服务 server/agentStrength.mjs 的 STRENGTHS 对应（对账在 serverSync.test.ts）。 */
export const STRENGTH_OPTIONS = [
  { id: "standard", label: "标准", state: "Sonnet，快、省额度（默认）" },
  { id: "strong", label: "更强", state: "Opus + 中等思考强度，写得更细" },
  { id: "max", label: "最强", state: "Opus + XHigh 思考强度，写得最细，也最慢、最费额度" },
] as const;

/** 本机 AI 助手那一块：假火山模式用不到，小服务没报清单（旧版）也不画。 */
export const showAgent = (health: Health) => !health.fake && Boolean(health.agents?.length);
/** 写词强度那一排：小服务没报（旧版）不画。 */
export const showStrength = (health: Health) => !health.fake && Boolean(health.agentStrength);

/** 火山 Key 要不要直接摊开填写框：真模式下没填、或火山说不对才摊开；填好了只显示打勾那一行。 */
export const mustFillKey = (health: Health, keyRejected = false) => !health.fake && (!health.keyReady || keyRejected);

/** 火山 Key 收起时那一行：每项一个勾，或一句缺什么。 */
export function keyStatus(health: Health, keyRejected = false): { name: string; ok: boolean; note: string }[] {
  return [
    { name: "方舟 Key", ok: health.keyReady && !keyRejected, note: keyRejected ? "火山说不对" : health.keyReady ? "已填" : "没填" },
    { name: "TOS", ok: health.tosReady, note: health.tosReady ? "已填" : "没填（只有拿视频当参考出片才要）" },
  ];
}

/** 功能那一块标题右边的一句话：都能用，还是几项不能用。 */
export function featureSummary(health: Health, keyRejected = false): { ok: boolean; text: string } {
  const main = featureChecklist(health, keyRejected).main;
  const broken = main.filter(row => !row.ok).length;
  return { ok: !broken, text: broken ? `${broken} 项还不能用` : `${main.length} 项都能用` };
}
