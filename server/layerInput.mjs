// 检查页面发来的图层分离请求。花钱前最后一道关：火山的输入限制（11-16 官方文档）先在这里拦，不让它白跑一趟。
import { isId } from './store/files.mjs';
import { imageSize } from './imageSize.mjs';
import { priceOf } from './pricing.mjs';
import { LAYER_MODEL, MAX_BOXES, MAX_LAYER_IMAGES, layerPrompt } from './layerSplit.mjs';

export const MAX_LAYER_TEXT = 500;
const MIN_PIXELS = 512 * 512;
const MAX_PIXELS = 6000 * 6000;

const no = reason => ({ ok: false, reason });
const isBox = box => Array.isArray(box) && box.length === 4 && box.every(v => Number.isInteger(v) && v >= 0 && v <= 1000)
  && box[2] > box[0] && box[3] > box[1];

/** readImage({ type, id }) 返回 { buffer, kind, contentType } 或 null。通过返回 { ok: true, job }。 */
export function checkLayerInput(body, readImage) {
  const b = body ?? {};
  if (!isId(b.canvasId)) return no('没说是哪张画布。');
  if (typeof b.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.cardId)) return no('没说是哪张卡片。');
  const source = b.source;
  if (!source || (source.type !== 'upload' && source.type !== 'work') || !isId(source.id)) return no('原图的编号不对。');
  const image = readImage(source);
  if (!image) return no('原图在硬盘上找不到了（可能被删了）。');
  if (image.kind !== 'image') return no('图层分离只能拆图片。');
  if (!['image/png', 'image/jpeg'].includes(image.contentType)) return no('火山图层分离只收 PNG 或 JPG 图片，这张要先转格式。');
  const size = imageSize(image.buffer);
  if (!size) return no('读不出这张图的尺寸。');
  const pixels = size.width * size.height, ratio = size.width / size.height;
  if (pixels < MIN_PIXELS) return no(`图太小了（${size.width}×${size.height}），火山图层分离要求至少 512×512 的面积。`);
  if (pixels > MAX_PIXELS) return no(`图太大了（${size.width}×${size.height}），火山图层分离最多 6000×6000。`);
  if (ratio < 1 / 16 || ratio > 16) return no('图太细长了，火山图层分离要求宽高比在 1:16 到 16:1 之间。');
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (text.length > MAX_LAYER_TEXT) return no(`描述太长了（${text.length} 字），最多 ${MAX_LAYER_TEXT} 字。`);
  if (b.boxes !== undefined && !Array.isArray(b.boxes)) return no('框选的格式不对。');
  const boxes = b.boxes ?? [];
  if (boxes.length > MAX_BOXES) return no(`最多框 ${MAX_BOXES} 处。`);
  if (!boxes.every(isBox)) return no('框选的位置不对，重新框一下。');
  // origin：卡上那张原图（WebP 时页面先转成 PNG 另存一份交上来，source 是转好的那份）；拆完按 origin 对回卡片。
  const origin = b.origin ?? source;
  if ((origin.type !== 'upload' && origin.type !== 'work') || !isId(origin.id)) return no('原图的编号不对。');
  const price = priceOf(LAYER_MODEL);
  return { ok: true, job: { canvasId: b.canvasId, cardId: b.cardId, source: { type: source.type, id: source.id },
    origin: { type: origin.type, id: origin.id }, text, boxes,
    prompt: layerPrompt(text, boxes), priceYuan: price, maxYuan: Math.round(price * MAX_LAYER_IMAGES * 100) / 100 } };
}

/**
 * 11-16 图层重绘：对一个图层写一句话，AI 只重画这一层（透明底 PNG 进、透明底 PNG 出，一张图的钱）。
 * readLayer(id) 返回 { buffer, kind, contentType, layer }（layer 是作品上的图层标记）或 null。
 */
export function checkRedrawInput(body, readLayer) {
  const b = body ?? {};
  if (!isId(b.canvasId)) return no('没说是哪张画布。');
  if (typeof b.cardId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(b.cardId)) return no('没说是哪张卡片。');
  if (!isId(b.layer)) return no('图层的编号不对。');
  const image = readLayer(b.layer);
  if (!image) return no('这个图层在硬盘上找不到了（可能被删了）。');
  if (image.kind !== 'image' || image.contentType !== 'image/png' || image.layer?.role !== 'layer') return no('只能重绘图层分离拆出来的图层。');
  const size = imageSize(image.buffer);
  if (!size) return no('读不出这个图层的尺寸。');
  const ratio = size.width / size.height;
  if (ratio < 1 / 16 || ratio > 16) return no('这个图层太细长了，火山要求宽高比在 1:16 到 16:1 之间。');
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return no('先写一句想怎么重绘这个图层。');
  if (text.length > MAX_LAYER_TEXT) return no(`描述太长了（${text.length} 字），最多 ${MAX_LAYER_TEXT} 字。`);
  const name = typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 40) : (image.layer.name ?? '图层');
  return { ok: true, job: { canvasId: b.canvasId, cardId: b.cardId, from: b.layer, name, text, prompt: text,
    size: `${size.width}x${size.height}`, layerOf: image.layer.of ?? null, priceYuan: priceOf(LAYER_MODEL) } };
}
