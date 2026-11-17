// 火山 Seedream 图层分离（11-16 用两张鞋图真测过，见 进度档案/2026-11-16.md）。
// 官方：出图接口加 layer_decomposition: true；只收 1 张 PNG / JPEG；提示词可不写（自动拆）、写一句话点名、
// 或用 <bbox>x1 y1 x2 y2</bbox>（0~1000 归一化坐标）框区域。回一张底图（z_index 0，零件拿走处自动补好）+ 若干透明 PNG 图层，
// 每层带 name、bounding_box.absolute（底图上的像素坐标）。返回的是链接（24 小时有效），要马上下载。
// 任一图层失败整单报错；只对成功生成的图按张收费（Flash 每张 ¥0.12）。
import { IMAGE_TIMEOUT_MS, seedreamConfig, upstreamMessage } from './seedream.mjs';

/** 图层分离用的模型：Flash 支持图层拆分（Lite 不支持），和出图默认模型同一个。 */
export const LAYER_MODEL = 'doubao-seedream-5-0-flash-260915';
/** Flash 一次最多 1 张底图 + 16 个图层。 */
export const MAX_LAYER_IMAGES = 17; // 页面 src/domain/layers.ts 同名常量写在提示里，两边一起改
export const MAX_BOXES = 16;
const DOWNLOAD_TIMEOUT_MS = 120000;

/** 框选和文字拼成提示词（框写在前，照官方示例「将图片进行精确图层分离，需分离的…坐标为<bbox>…」）。都没有返回空串 = 自动拆。 */
export function layerPrompt(text, boxes = []) {
  const tags = boxes.map(box => `<bbox>${box.join(' ')}</bbox>`).join('、');
  return [tags ? `将图片进行精确图层分离，需分离的区域坐标为${tags}` : '', String(text ?? '').trim()].filter(Boolean).join('。');
}

export function buildLayerBody({ image, prompt }) {
  const type = String(image?.contentType ?? 'image/png').toLowerCase();
  return {
    model: LAYER_MODEL,
    ...(prompt ? { prompt } : {}),
    image: `data:${type};base64,${Buffer.from(image?.buffer ?? []).toString('base64')}`,
    layer_decomposition: true,
    response_format: 'url',
    output_format: 'png',
    watermark: false
  };
}

const sizeOf = text => {
  const match = /^(\d+)x(\d+)$/.exec(String(text ?? ''));
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
};
const boxOf = raw => Array.isArray(raw) && raw.length === 4 && raw.every(Number.isFinite) && raw[2] > raw[0] && raw[3] > raw[1] ? raw.map(Number) : null;

/** 从火山回话里挑出底图和图层；形状不对返回 null。count 是火山说生成了几张（收费按它）。 */
export function readLayerReply(payload) {
  const items = Array.isArray(payload?.data) ? payload.data.filter(item => typeof item?.url === 'string' && item.url) : [];
  const charged = Number(payload?.usage?.generated_images);
  const count = Number.isInteger(charged) && charged >= 0 ? charged : items.length;
  const baseItem = items.find(item => item.z_index === 0);
  const base = baseItem && sizeOf(baseItem.size);
  if (!base) return null;
  const layers = items.filter(item => item !== baseItem && boxOf(item.bounding_box?.absolute))
    .sort((a, b) => Number(a.z_index) - Number(b.z_index))
    .map((item, index) => ({ url: item.url, name: String(item.name ?? '').trim().slice(0, 40) || `图层 ${index + 1}`,
      box: boxOf(item.bounding_box.absolute) }));
  return { count, base: { url: baseItem.url, ...base }, layers };
}

async function download(url, doFetch) {
  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await doFetch(url, { timeout: DOWNLOAD_TIMEOUT_MS });
      if (response.status === 200) return Buffer.from(await response.arrayBuffer());
      last = new Error(`HTTP ${response.status}`);
    } catch (err) { last = err; }
  }
  throw last;
}

/**
 * 发一次图层分离。返回 { ok: true, count, base: { buffer, width, height }, layers: [{ buffer, name, box }] }
 * 或 { ok: false, status, message, charged }（charged = 已经扣了几张的钱，0 = 没花钱）。
 * 网络层出错抛 EDIT_TIMEOUT / EDIT_UNREACHABLE / EDIT_INTERRUPTED，和出图同一套。Key 只在这里用，不进返回值和日志。
 */
export async function splitLayers({ image, prompt }, { env, fetch: doFetch, log = console.error, timeout = IMAGE_TIMEOUT_MS }) {
  const cfg = seedreamConfig(env);
  let response;
  try {
    response = await doFetch(`${cfg.base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(buildLayerBody({ image, prompt }))),
      timeout
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('EDIT_TIMEOUT');
    log(`[图层分离] ${err?.notSent ? '连不上火山' : '请求发出后断了'}：${String(err?.message ?? err).replaceAll(cfg.key, '***')}`);
    throw new Error(err?.notSent ? 'EDIT_UNREACHABLE' : 'EDIT_INTERRUPTED');
  }
  const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* 不是 JSON 就把原文当原因 */ }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, status: response.status, message: upstreamMessage(payload, raw), charged: 0 };
  }
  const reply = readLayerReply(payload);
  if (!reply) return { ok: false, status: response.status, message: '火山回话了，但没给底图。', charged: Number(payload?.usage?.generated_images) || 0 };
  try {
    const base = { buffer: await download(reply.base.url, doFetch), width: reply.base.width, height: reply.base.height };
    const layers = [];
    for (const layer of reply.layers) layers.push({ buffer: await download(layer.url, doFetch), name: layer.name, box: layer.box });
    return { ok: true, count: reply.count, base, layers };
  } catch (err) {
    log(`[图层分离] 下载图层失败：${String(err?.message ?? err)}`);
    return { ok: false, status: 0, charged: reply.count,
      message: `火山已经拆好并扣费（${reply.count} 张），但图层下载失败（试了 3 次）。没有自动重发。` };
  }
}
