import { priceOf } from './pricing.mjs';

export const FLASH_MODEL = 'doubao-seedream-5-0-flash-260915';
const LITE_MODEL = 'doubao-seedream-5-0-lite-260128';
const DAY_MS = 86400000;

export function characterPrompt(description) {
  return `${description}。人物设定图：同一个人，左边依次是正面、侧面、背面三个全身像，右边是一张脸部正面特写；纯白背景，柔和均匀的光，写实照片质感，画面里只有这一个人，不要任何文字和标注。`;
}

export function characterImageJob(characterId, description) {
  return { canvasId: null, cardId: null, characterId, model: FLASH_MODEL,
    prompt: characterPrompt(description), size: '2736x1536', count: 1, refs: [], priceYuan: priceOf(FLASH_MODEL) };
}

/** 以作品原始记录判断，素材编号优先于图片来源。 */
export function characterVideo(image, work, now = Date.now()) {
  if (image.assetId) return { status: 'asset' };
  if (image.ref.type === 'upload') return { status: 'photo' };
  if (![FLASH_MODEL, LITE_MODEL].includes(work?.model) || (work.refs ?? []).length !== 0) return { status: 'edited' };
  const created = Date.parse(work.createdAt);
  const remaining = created + 30 * DAY_MS - now;
  return Number.isFinite(created) && created <= now && remaining > 0
    ? { status: 'trusted', days: Math.ceil(remaining / DAY_MS) } : { status: 'expired' };
}
