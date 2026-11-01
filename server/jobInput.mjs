// 检查页面发来的出图请求。这里是花钱前最后一道关：该拒就拒，不悄悄改用户的话。
import { isId } from './store/files.mjs';
import { isImageModel, priceOf } from './pricing.mjs';

export const MAX_REFS = 8;
export const MAX_COUNT = 4;
export const MAX_PROMPT = 4000;

const no = (reason) => ({ ok: false, reason });

/**
 * 通过返回 { ok: true, job }（job 是要落盘的字段），不通过返回 { ok: false, reason }。
 * hasAsset({ type, id }) 返回文件元数据或是否存在；视频参考必须返回 kind 供检查。
 */
export function checkJobInput(body, hasAsset) {
  const b = body ?? {};
  if (!isId(b.canvasId)) return no('没说是哪张画布。');
  if (typeof b.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.cardId)) return no('没说是哪张卡片。');
  if (!isImageModel(b.model)) return no('出图模型认不出来。');
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return no('先写一句你想要什么。');
  if (prompt.length > MAX_PROMPT) return no(`提示词太长了（${prompt.length} 字），最多 ${MAX_PROMPT} 字。`);
  if (!Number.isInteger(b.count) || b.count < 1 || b.count > MAX_COUNT) return no(`张数要在 1 到 ${MAX_COUNT} 之间。`);
  const size = typeof b.size === 'string' && /^\d{2,5}x\d{2,5}$/.test(b.size) ? b.size : null;
  if (b.size != null && !size) return no('尺寸格式不对。');
  if (b.refs !== undefined && !Array.isArray(b.refs)) return no('参考图的格式不对。');
  const refs = b.refs ?? [];
  if (refs.length > MAX_REFS) return no(`一次最多 ${MAX_REFS} 张参考图。`);
  for (const ref of refs) {
    if (!ref || (ref.type !== 'upload' && ref.type !== 'work') || !isId(ref.id)) return no('参考图的编号不对。');
    const asset = hasAsset(ref);
    if (!asset) return no('有一张参考图在硬盘上找不到了（可能被删了），断开它再发。');
    if (asset.kind === 'video' || asset.contentType?.startsWith('video/')) return no('出图不能拿视频当参考。');
  }
  return {
    ok: true,
    job: {
      canvasId: b.canvasId,
      cardId: b.cardId,
      model: b.model,
      prompt,
      size,
      count: b.count,
      refs: refs.map(({ type, id }) => ({ type, id })),
      priceYuan: priceOf(b.model)
    }
  };
}
