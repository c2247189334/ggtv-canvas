import { EDIT_WORDS } from '../videoRewrite/rules.mjs';

export const productIdOf = material => material.productId ?? (material.role === 'product' ? material.itemId : undefined);
export const productMaterials = materials => materials.filter(row => row.tag.startsWith('@图片') && productIdOf(row));

/** 看图回话能进入提示词的短句，不允许素材编号或编辑任务措辞。 */
export function productPhrase(value, limit = 80) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || /@|(?:商品|图片|视频|图像)\s*[A-Z\d]+/i.test(text) || EDIT_WORDS.some(word => text.includes(word))) return '';
  return [...text].slice(0, limit).join('').replace(/[。；;]+$/, '');
}

export async function lookProducts({ products, materials, images }, { ask }) {
  const groups = products.map(product => ({ id: product.id, name: product.name,
    tags: materials.filter(row => productIdOf(row) === product.id).map(row => row.tag) })).filter(row => row.tags.length);
  if (!groups.length) return {};
  const reply = await ask({ round: 'product-look', images, context: { products: groups, tags: materials.map(row => row.tag) },
    text: '按顺序看商品实物照，同一商品的不同角度合在一起判断，只答每个商品的id、features和wear。'
      + 'features一句外观，写颜色、款式、结构、鞋底等，不超过80字，不写编号或编辑词。'
      + 'wear只许"直接套脚"、"要系带"、"看不出"或""；非鞋类留空。只看这些图，不猜原视频。'
      + `\n商品与图的对应：${JSON.stringify(groups)}\n只回JSON：{"products":[{"id":"${groups[0].id}","features":"","wear":""}]}` });
  const answers = Array.isArray(reply?.products) ? reply.products : null;
  if (!answers?.length) throw Error(`看商品图回话不对，没有商品回答：${JSON.stringify(reply)}`);
  return Object.fromEntries(groups.map((group, index) => {
    const row = answers.find(answer => answer?.id === group.id) ?? answers[index] ?? {};
    return [group.id, { features: productPhrase(row.features),
      wear: /鞋|靴/.test(group.name) && ['直接套脚', '要系带', '看不出', ''].includes(row.wear) ? row.wear : '' }];
  }));
}
