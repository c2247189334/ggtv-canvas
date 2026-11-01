// 出图单价（人民币 / 张）。火山官方按张收固定价，参考图不收钱（旧项目 2026-09-26 查的）。
// ⚠ 页面估价用的是 src/domain/pricing.ts 里同样两个数，改价两边一起改。
export const IMAGE_PRICES = {
  'doubao-seedream-5-0-flash-260915': 0.12,
  'doubao-seedream-5-0-lite-260128': 0.22
};

export function isImageModel(id) {
  return typeof id === 'string' && Object.hasOwn(IMAGE_PRICES, id);
}

/** 认不出的按最贵的算 —— 宁可多记，别少记。 */
export function priceOf(id) {
  return isImageModel(id) ? IMAGE_PRICES[id] : Math.max(...Object.values(IMAGE_PRICES));
}
