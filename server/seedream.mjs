// 火山 Seedream 出图。从旧项目 服务端/seedream.mjs 搬来（2026-10-20），改了两处：
//   · 去掉「拆 multipart、拼成 OpenAI 形状」那层：新项目的排队直接调 generateOne，一次一张；
//   · Key 和 fetch 由调用方传进来，不自己读 .env.local（好测试）。
//
// 火山的三个规矩（官方 API 文档，旧项目 2026-09-26 读的）：
//   1. 没有 low/medium/high 档位；
//   2. 一次只出 1 张，要几张由排队那边连发几次；
//   3. 输出像素有区间：pro/flash [1280×720, 2048×2048×1.1025]，lite/4.5 [2560×1440, 4096×4096]。
//      页面按 1K / 2K / 3K 总像素和比例算尺寸；模型可选档位在区间内，这里保留越界兜底。
//
// Key 只在 seedreamConfig / generateOne 里出现，绝不进返回值、日志、错误信息。
import { transport } from './net.mjs';

export const DEFAULT_SEEDREAM_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
/** 一张图最多等多久。旧项目一直用 5 分钟。 */
export const IMAGE_TIMEOUT_MS = 300000;

/** 只读配置，不外传。缺 Key 抛 ARK_KEY_MISSING。 */
export function seedreamConfig(env) {
  const key = String(env?.ARK_API_KEY ?? '').trim();
  if (!key || /^请/.test(key)) throw new Error('ARK_KEY_MISSING');
  const rawBase = String(env?.ARK_BASE_URL ?? '').trim();
  const base = ((!rawBase || /^请/.test(rawBase)) ? DEFAULT_SEEDREAM_BASE : rawBase).replace(/\/+$/, '');
  return { key, base };
}

// ---------- 尺寸 ----------

const PIXELS_PRO_FLASH = { min: 1280 * 720, max: Math.floor(2048 * 2048 * 1.1025) };
const PIXELS_LITE = { min: 2560 * 1440, max: 4096 * 4096 };

function pixelLimitsOf(model) {
  return /^doubao-seedream-5-0-(pro|flash)/.test(String(model)) ? PIXELS_PRO_FLASH : PIXELS_LITE;
}

/**
 * 把页面算出来的「宽x高」换算成这个模型能收的尺寸：区间内原样不动，
 * 太小按比例放大、太大按比例缩小，边长对齐到 16 的倍数（官方没写要不要对齐，对齐了不吃亏）。
 * 不是「宽x高」写法（空、2K、auto）一律返回 undefined，让火山用默认值。
 */
export function seedreamSize(model, size) {
  const match = /^(\d+)x(\d+)$/.exec(String(size ?? '').trim());
  if (!match) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(width > 0 && height > 0)) return undefined;

  const { min, max } = pixelLimitsOf(model);
  const pixels = width * height;
  if (pixels >= min && pixels <= max) return `${width}x${height}`;

  // 放大时边长向上取整到 16 的倍数：两边都只增不减，乘积一定 ≥ 下限；缩小时反过来向下取整。
  const factor = Math.sqrt((pixels < min ? min : max) / pixels);
  const round = pixels < min ? Math.ceil : Math.floor;
  const w = Math.max(16, round((width * factor) / 16) * 16);
  const h = Math.max(16, round((height * factor) / 16) * 16);
  return `${w}x${h}`;
}

// ---------- 拼请求体 ----------

/** 图片转成火山要的 data URL（官方要求 `data:image/<小写格式>;base64,...`）。 */
function dataUrlOf(image) {
  const type = String(image?.contentType ?? 'image/png').toLowerCase();
  return `data:${type};base64,${Buffer.from(image?.buffer ?? []).toString('base64')}`;
}

/**
 * 火山 /images/generations 的请求体。
 * 一张图时 image 是字符串、多张是数组（照官方文档的两种写法）；没图就是纯文字出图，不带 image。
 * `sequential_image_generation` 一个字都不发：pro / flash 官方写「不支持配置」，其余默认就是关。
 */
export function buildSeedreamBody({ model, prompt, images = [], size }) {
  const urls = images.map(dataUrlOf);
  return {
    model: String(model ?? ''),
    prompt: String(prompt ?? ''),
    ...(urls.length === 1 ? { image: urls[0] } : urls.length > 1 ? { image: urls } : {}),
    ...(size ? { size } : {}),
    response_format: 'b64_json',
    output_format: 'jpeg',
    watermark: false
  };
}

// ---------- 发请求 ----------

/** 火山的错误原文里挑一句给人看。 */
export function upstreamMessage(payload, raw) {
  const message = payload?.error?.message;
  if (typeof message === 'string' && message.trim()) return message.trim().slice(0, 300);
  return String(raw ?? '').slice(0, 300) || '（火山没给原因）';
}

/**
 * 发一次，出一张。返回 { ok: true, image } 或 { ok: false, status, message }。
 * 网络层出错抛 EDIT_TIMEOUT / EDIT_UNREACHABLE；真实原因只进黑窗口，Key 打码。
 */
export async function generateOne({ model, prompt, images = [], size }, { env, fetch: doFetch, log = console.error, timeout = IMAGE_TIMEOUT_MS }) {
  const cfg = seedreamConfig(env);
  const body = buildSeedreamBody({ model, prompt, images, size: seedreamSize(model, size) });
  let response;
  try {
    response = await doFetch(`${cfg.base}/images/generations`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.key}`, 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(body)),
      timeout,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('EDIT_TIMEOUT');
    log(`[出图] 连不上火山：${String(err?.message ?? err).replaceAll(cfg.key, '***')}`);
    throw new Error('EDIT_UNREACHABLE');
  }
  const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
  let payload = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    /* 不是 JSON 就把原文当原因 */
  }
  if (response.status < 200 || response.status >= 300) {
    return { ok: false, status: response.status, message: upstreamMessage(payload, raw) };
  }
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const b64 = items.find((item) => typeof item?.b64_json === 'string' && item.b64_json)?.b64_json;
  if (!b64) return { ok: false, status: response.status, message: '火山回话了，但没给图。' };
  return { ok: true, image: Buffer.from(b64, 'base64') };
}

let netFetch = null;
/** 正式出图用的 fetch：走 net.mjs（这台电脑的代理会给假地址，直连火山连不上，要绕一下）。 */
export function defaultArkFetch() {
  if (!netFetch) netFetch = transport({ TOS_BUCKET: '' }).fetch;
  return netFetch;
}
