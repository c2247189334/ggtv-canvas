import { VIDEO_RATIOS } from '../videoModels.mjs';
import { checkCardId, checkDuration, checkMaterials, checkUserText } from '../videoRewrite/input.mjs';
import { productIdOf } from './lookProducts.mjs';

export function checkProductPlan(plan) {
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.products) || !plan.products.length || plan.products.length > 100
    || !Array.isArray(plan.looks) || !Array.isArray(plan.timeline) || !Array.isArray(plan.unsure)
    || typeof plan.visible !== 'string' || typeof plan.face !== 'boolean') throw Error('商品拆解单不完整，请重新拆解。');
  const ids = new Set();
  for (const row of plan.products) {
    if (!row || !/^[A-Z]{1,3}$/.test(row.id) || ids.has(row.id) || typeof row.name !== 'string' || !row.name.trim()
      || typeof row.look !== 'string' || typeof row.layout !== 'string' || !Number.isInteger(row.pairs) || row.pairs < 0
      || !Number.isInteger(row.pieces) || row.pieces < 0 || (row.where !== undefined && typeof row.where !== 'string')
      || (row.sameAs !== undefined && (!/^[A-Z]{1,3}$/.test(row.sameAs) || row.sameAs === row.id))) throw Error('商品拆解单的商品格式不对。');
    ids.add(row.id);
  }
  if (plan.products.some(row => row.sameAs && !ids.has(row.sameAs))) throw Error('「跟商品X一样」指向的商品不在拆解单里。');
  if (plan.looks.some(row => !row || !['scene', 'outfit'].includes(row.kind) || ['what', 'now', 'target'].some(field => typeof row[field] !== 'string'))
    || plan.timeline.some(row => !row || !Number.isInteger(row.from) || !Number.isInteger(row.to) || row.from < 0 || row.to <= row.from || typeof row.action !== 'string')
    || plan.unsure.some(row => typeof row !== 'string')) throw Error('商品拆解单的外观或时间轴格式不对。');
  return plan;
}

export function checkProductMaterials(value) {
  const checked = checkMaterials(value);
  return checked.map((row, index) => {
    const raw = value[index];
    if (raw.role !== undefined && !['product', 'background'].includes(raw.role)) throw Error('商品图片身份不对。');
    if (raw.productId !== undefined && !/^[A-Z]{1,3}$/.test(raw.productId)) throw Error('商品编号不对。');
    return { ...row, ...(raw.role ? { role: raw.role } : {}), ...(raw.productId ? { productId: raw.productId } : {}) };
  });
}

export function checkProductPromptInput(body) {
  checkCardId(body?.cardId); checkDuration(body?.duration); checkDuration(body?.sourceDuration ?? body?.duration);
  const plan = checkProductPlan(body.plan), materials = checkProductMaterials(body.materials);
  if (!VIDEO_RATIOS.includes(body.ratio) || body.ratio === 'adaptive') throw Error('请选择固定视频比例。');
  if (!materials.some(row => row.tag === '@视频1')) throw Error('请连入原视频作为 @视频1。');
  if (!materials.some(row => row.tag.startsWith('@图片') && productIdOf(row))) throw Error('请先补上商品实物照。');
  const hasImage = id => materials.some(row => row.tag.startsWith('@图片') && productIdOf(row) === id && row.asset);
  for (const product of plan.products) {
    if (!hasImage(product.id) && !(product.sameAs && hasImage(product.sameAs))) {
      throw Error(`商品${product.id}还没有实物照，请先补齐图片；这次没发出去。`);
    }
  }
  for (const row of materials.filter(row => row.tag.startsWith('@图片') && (productIdOf(row) || row.role === 'background'))) {
    if (!row.asset) throw Error(`${row.tag}还没有图片，请先补齐这张图片；这次没发出去。`);
    if (productIdOf(row) && !plan.products.some(product => product.id === productIdOf(row))) throw Error('图片引用了不存在的商品。');
  }
  return { ...body, plan, materials, userText: checkUserText(body.userText), sourceDuration: body.sourceDuration ?? body.duration };
}
