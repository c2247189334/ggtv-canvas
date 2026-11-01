import { EDIT_WORDS } from './rules.mjs';

const CLOTHES_MAX = 60, HAIR_MAX = 20;

/** 要换的人物、连了图的那几行素材；背景、衣服、深度、没换的人都不问。 */
export function personMaterials({ plan, materials }) {
  return materials.filter(row => row.asset && row.tag.startsWith('@图片') && plan.replace.includes(row.itemId)
    && plan.items.find(item => item.id === row.itemId)?.kind === '人物');
}

const question = tags => `下面按顺序给你 ${tags.length} 张人物参考图，编号依次是 ${tags.join('、')}。每张图只回答下面四项，不要写别的：
- views：图里这个人一共出现几次（同一个人的正面、侧面、背面三视图写 3；只有一个身影写 1）。
- plainClothes：身上是不是只穿着没有图案的纯色打底衣服（比如纯色T恤加打底裤、纯色紧身衣）——这种衣服只是占位，写 true；有明显款式、图案、制服、外套或配饰就写 false。
- clothes：一句话写衣服和鞋：名称、颜色和最显眼的细节，不超过 40 字；看不到鞋就不写鞋。只写看到的样子，不写编号，不用「增加、去掉、改成、替换」这类词。
- hair：一句话写发型和发色，不超过 15 字。
只回一个 JSON：{"people":[{"tag":"${tags[0]}","views":1,"plainClothes":false,"clothes":"……","hair":"……"}]}，每张图一项，顺序和编号同上。`;

/** 写进提示词的字：带编号或编辑触发词就整句不要（会被检查拦），太长截断。 */
function phrase(value, max) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text || text.includes('@') || EDIT_WORDS.some(word => text.includes(word))) return '';
  return [...text].slice(0, max).join('');
}

/**
 * 10-30 功夫舞真成片后加：拼词前看一次要换的人物图，只答固定四项，代码按答案填模板，不让豆包写整段。
 * 简单认图，关深度思考省钱省时；回话格式毛病能纠正就纠正（没写编号按顺序对、次数乱写当 1），没有人物列表才报错（钱已花，不重发）。
 */
export async function lookPeople({ materials, images }, { ask }) {
  if (!materials.length) return {};
  const tags = materials.map(row => row.tag);
  const reply = await ask({ round: 'look', text: question(tags), images, think: false, context: { tags } });
  const people = Array.isArray(reply?.people) ? reply.people : null;
  if (!people?.length) throw Error(`豆包看图回话不对，没有每张人物图的回答：${JSON.stringify(reply)}`);
  return Object.fromEntries(tags.map((tag, index) => {
    const row = people.find(entry => entry?.tag === tag) ?? people[index] ?? {};
    const views = Number(row.views);
    return [tag, { views: Number.isInteger(views) && views >= 1 && views <= 9 ? views : 1,
      plainClothes: row.plainClothes === true || row.plainClothes === 'true',
      clothes: phrase(row.clothes, CLOTHES_MAX), hair: phrase(row.hair, HAIR_MAX) }];
  }));
}

/** 假看图（零花费）：每张图都是穿深色外套的短发人。 */
export async function fakeLook({ context }) {
  return { people: context.tags.map(tag => ({ tag, views: 1, plainClothes: false, clothes: '深色外套和长裤，黑色皮鞋', hair: '黑色短发' })) };
}
