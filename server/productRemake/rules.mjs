import { checkRules, originalDescriptionMatch } from '../videoRewrite/rules.mjs';
import { productIdOf } from './lookProducts.mjs';

/** 共用编号、编辑词、长度、字幕和整数连续时间轴，商品卡另外检查参考原片职责与身份。 */
export function checkProductRules(input) {
  const materials = input.materials ?? [], text = input.videoPrompt ?? '', plan = input.plan;
  const baseMaterials = materials.map(row => ({ ...row, purpose: row.role === 'background' ? '背景' : row.purpose }));
  const issues = checkRules({ ...input, duration: Math.ceil(input.duration), materials: baseMaterials, changeSeconds: [], plan: undefined });
  for (const row of materials.filter(row => row.tag.startsWith('@图片'))) {
    if (!productIdOf(row) && row.role !== 'background') issues.push(`${row.tag} 没身份：放进商品组或剪掉连线`);
  }
  const videoSentence = text.split(/[。；;\n]/).find(sentence => sentence.includes('@视频1')) ?? '';
  if (!videoSentence.includes('动作') || !videoSentence.includes('运镜')) issues.push('@视频1 必须在同一句写明参考「动作」和「运镜」。');
  const originals = [...(plan?.products ?? []).map(row => ({ label: `商品${row.id}`, desc: row.look })),
    ...(plan?.looks ?? []).map(row => ({ label: row.what, desc: row.now }))];
  for (const { label, desc } of originals) {
    const fragment = originalDescriptionMatch(text, desc);
    if (fragment) issues.push(`${label}还写着原视频的原描述「${fragment}」，请删掉这段。`);
  }
  for (const product of plan?.products ?? []) {
    for (const row of materials.filter(material => productIdOf(material) === product.id)) {
      if (!text.includes(row.tag)) issues.push(`商品${product.id}的 ${row.tag} 没写到提示词里。`);
    }
  }
  return [...new Set(issues)];
}
