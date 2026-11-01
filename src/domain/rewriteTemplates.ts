/** 与 server/videoRewrite/roles.mjs 的 imageTemplate 保持一致，由测试逐字对照。 */
export function rewriteImageTemplate(kind: string): string {
  if (kind === '人物') return '（在这里写你想要的人物：性别、年龄、长相、发型），单人全身正面照，穿简单的纯色贴身衣服，纯色背景。';
  if (kind === '衣服') return '（在这里写你想要的衣服：颜色、款式、长短、材质），衣服平铺或无头人台展示，纯色背景，不出现人脸。';
  return '（在这里写你想要的样子：颜色、形状、材质），单独物品，纯色背景。';
}
