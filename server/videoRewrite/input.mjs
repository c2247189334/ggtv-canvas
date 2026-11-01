import { MAX_PROMPT } from '../jobInput.mjs';
import { VIDEO_RATIOS } from '../videoModels.mjs';
import { validatePlan, validCardId } from './analyze.mjs';
import { isId } from '../store/files.mjs';

export function checkCardId(id) {
  if (!validCardId(id)) throw Error('改写任务编号不对，只能用1到64个英文字母、数字、下划线或横线。');
  return id;
}
export function checkDuration(duration) {
  if (!Number.isFinite(duration) || duration < 4 || duration > 30) throw Error('视频改写只接受4到30秒的源视频，请先截短或换一段视频；这次没发出去，没花钱。');
}
export function checkChangeSeconds(value = [], duration) {
  if (!Array.isArray(value) || value.some(second => !Number.isFinite(second) || second < 0 || second >= duration)) {
    throw Error('变化点秒数必须是视频时长内有限、非负且小于时长的数字数组。');
  }
  return value;
}
export function checkUserText(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('请先写一句想换什么。');
  if (value.length > MAX_PROMPT) throw Error(`用户原话最多${MAX_PROMPT}字。`);
  return value.trim();
}
export function checkMaterials(materials) {
  if (!Array.isArray(materials) || materials.length > 100) throw Error('素材对照表必须是最多100项的数组。');
  const seen = new Set();
  return materials.map(item => {
    if (!item || typeof item.tag !== 'string' || !/^@(图片|视频|音频)[1-9]\d{0,2}$/.test(item.tag)
      || seen.has(item.tag) || typeof item.purpose !== 'string' || !item.purpose.trim() || item.purpose.length > MAX_PROMPT
      || (item.itemId !== undefined && !validCardId(item.itemId))
      || (item.asset !== undefined && (!item.asset || !['upload', 'work'].includes(item.asset.type) || !isId(item.asset.id)))
      || (item.originalDesc !== undefined && (typeof item.originalDesc !== 'string' || item.originalDesc.length > MAX_PROMPT))) throw Error('素材对照表的编号、用途、图片引用或原描述不对，编号不能重复；这次没发出去，没花钱。');
    seen.add(item.tag);
    return { tag: item.tag, purpose: item.purpose, ...(item.itemId === undefined ? {} : { itemId: item.itemId }),
      ...(item.asset === undefined ? {} : { asset: { type: item.asset.type, id: item.asset.id } }),
      ...(item.originalDesc === undefined ? {} : { originalDesc: item.originalDesc }) };
  });
}
export function checkPromptInput(body) {
  checkCardId(body?.cardId); checkDuration(body?.duration);
  const sourceDuration = body.sourceDuration ?? body.duration;
  checkDuration(sourceDuration);
  if (!VIDEO_RATIOS.includes(body.ratio) || body.ratio === 'adaptive') throw Error('改写视频比例不支持，请选择固定画幅比例。');
  validatePlan(body.plan, sourceDuration);
  const materials = checkMaterials(body.materials);
  if (!materials.some(item => item.tag.startsWith('@图片'))) throw Error('请先连入至少一张图片，再生成提示词。');
  const missing = materials.find(item => item.tag.startsWith('@图片') && !item.asset);
  if (missing) throw Error(`${missing.tag}还没有图片，请先补齐这张图片；这次没发出去，没花钱。`);
  if (materials.some(item => item.itemId && !body.plan.items.some(entry => entry.id === item.itemId))) throw Error('素材对照表引用了不存在的改写项。');
  return { cardId: body.cardId, plan: body.plan, duration: body.duration, sourceDuration, ratio: body.ratio,
    userText: checkUserText(body.userText), materials };
}

export function nearestRatio(width, height) {
  return VIDEO_RATIOS.filter(ratio => ratio !== 'adaptive').sort((a, b) => {
    const distance = ratio => { const [w, h] = ratio.split(':').map(Number); return Math.abs(width / height - w / h); };
    return distance(a) - distance(b);
  })[0];
}
