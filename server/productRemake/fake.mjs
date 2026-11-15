import { setTimeout } from 'node:timers/promises';

export async function fakeProductAsk({ round, context }, { delayMs = 0 } = {}) {
  if (delayMs > 0) await setTimeout(delayMs);
  if (context.userText?.includes('假拆解失败')) throw Error('假拆解失败：这是验收用的拆解失败，没有调用AI。');
  if (round === 'product-look') return { products: context.products.map(product => ({ id: product.id,
    features: '米白低帮圆头免系带鞋，粉色弧形交叉侧条，白色细齿外底', wear: '直接套脚' })) };
  return { products: [{ id: 'A', name: '鞋子', look: '黑色厚底鞋', pairs: 1, pieces: 2, layout: '开头两只穿在脚上，随后左脚抬起展示鞋底，结尾双脚落地' }],
    visible: '手和腿', face: false,
    looks: [{ id: 'S1', kind: 'scene', what: '地面', now: '米黄格纹地砖', target: '深灰木地板' },
      { id: 'O1', kind: 'outfit', what: '裤子', now: '浅蓝牛仔裤', target: '浅灰宽松长裤' }],
    timeline: [{ from: 0, to: 2, action: '双脚站立，左脚抬起展示商品A鞋底' },
      { from: 2, to: context.duration, action: '左右脚交替展示商品A，结尾双脚落地' }], unsure: [] };
}
