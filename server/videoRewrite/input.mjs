import { MAX_PROMPT } from '../jobInput.mjs';
import { VIDEO_RATIOS } from '../videoModels.mjs';
import { validatePlan, validCardId } from './analyze.mjs';
import { isId } from '../store/files.mjs';
import { isNewScene, NEW_SCENE_PURPOSE } from './roles.mjs';

/**
 * 11-11 用户定：换新背景时也按场景每段铺一张背景卡；用户删掉多的（想几段共用一张），那几段就沿用前一张。
 * 所以只留还连着背景卡的场景，剩一个就当全片一个场景；跟原片时照旧全算（没连的段用拆解描述顶上）。和页面 `src/domain/videoRewrite.ts` 同名函数两边一起改。
 */
export function scenesInUse(plan, materials, sceneTexts = []) {
  if (!isNewScene(materials)) return plan;
  // 11-13：背景卡「不出图，用文字」的段也算在用（线剪了，但卡上写了这段要什么），不能并进前一段。
  const linked = new Set([...materials.filter(row => row.purpose === NEW_SCENE_PURPOSE && row.itemId).map(row => row.itemId),
    ...sceneTexts.map(row => row.sceneId).filter(Boolean)]);
  return { ...plan, items: plan.items.filter(item => item.kind !== '场景' || linked.has(item.id)) };
}

export const MAX_SCENE_TEXT = 300;
/**
 * 11-13 背景卡「不出图，用文字」：[{ title, sceneId?, text }]。sceneId 要是拆解单里的场景；原片只有一个地方时可以不填（这句管全片）。
 * 同一段不能写两次，也不能同时连着背景图（「同时有图和字，留一样」）。
 */
export function checkSceneTexts(value, plan, materials) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw Error('背景卡的字格式不对；这次没发出去。');
  const scenes = (plan?.items ?? []).filter(item => item.kind === '场景');
  const seen = new Set();
  return value.map(row => {
    const title = typeof row?.title === 'string' ? row.title.trim().slice(0, 40) : '';
    const text = typeof row?.text === 'string' ? row.text.trim() : '';
    if (!title) throw Error('背景卡的字缺了卡名；这次没发出去。');
    if (!text) throw Error(`${title} 选了用文字，还没写字。`);
    if (text.length > MAX_SCENE_TEXT) throw Error(`${title} 的字最多 ${MAX_SCENE_TEXT} 个。`);
    const sceneId = row.sceneId === undefined ? undefined : row.sceneId;
    if (sceneId !== undefined && !scenes.some(item => item.id === sceneId)) throw Error(`${title} 对不上拆解单里的场景，请重新做一次视频改写。`);
    if (sceneId === undefined && scenes.length > 1) throw Error(`${title} 没记是哪一段，请重新做一次视频改写。`);
    const key = sceneId ?? '全片';
    if (seen.has(key)) throw Error(`${title} 这一段写了两次字，留一张。`);
    seen.add(key);
    const image = materials.some(material => material.tag.startsWith('@图片') && material.purpose.startsWith('背景') && (sceneId === undefined || material.itemId === sceneId));
    if (image) throw Error(`${title} 这一段同时有图和字，留一样。`);
    return { title, ...(sceneId === undefined ? {} : { sceneId }), text };
  });
}

export function checkCardId(id) {
  if (!validCardId(id)) throw Error('改写任务编号不对，只能用1到64个英文字母、数字、下划线或横线。');
  return id;
}
export function checkDuration(duration) {
  if (!Number.isFinite(duration) || duration < 4 || duration > 30) throw Error('视频改写只接受4到30秒的源视频，请先截短或换一段视频；这次没发出去。');
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
      || (item.originalDesc !== undefined && (typeof item.originalDesc !== 'string' || item.originalDesc.length > MAX_PROMPT))) throw Error('素材对照表的编号、用途、图片引用或原描述不对，编号不能重复；这次没发出去。');
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
  if (missing) throw Error(`${missing.tag}还没有图片，请先补齐这张图片；这次没发出去。`);
  if (materials.some(item => item.itemId && !body.plan.items.some(entry => entry.id === item.itemId))) throw Error('素材对照表引用了不存在的改写项。');
  const sceneTexts = checkSceneTexts(body.sceneTexts, body.plan, materials);
  return { cardId: body.cardId, plan: scenesInUse(body.plan, materials, sceneTexts), duration: body.duration, sourceDuration, ratio: body.ratio,
    userText: checkUserText(body.userText), materials, ...(sceneTexts.length ? { sceneTexts } : {}), ...(body.keepClothes === true ? { keepClothes: true } : {}) };
}

export function nearestRatio(width, height) {
  return VIDEO_RATIOS.filter(ratio => ratio !== 'adaptive').sort((a, b) => {
    const distance = ratio => { const [w, h] = ratio.split(':').map(Number); return Math.abs(width / height - w / h); };
    return distance(a) - distance(b);
  })[0];
}
