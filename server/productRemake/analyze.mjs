import { analysisImages } from '../videoRewrite/analysisImages.mjs';

const text = value => typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.map(text).filter(Boolean).join('、') : '';
const list = value => Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : [];
const rowList = value => list(value).map(row => typeof row === 'string' ? { name: row, action: row, what: row } : row)
  .filter(row => row && typeof row === 'object' && !Array.isArray(row)).slice(0, 100);
const count = value => {
  const match = String(value ?? '').match(/\d+/);
  if (match) return Math.min(1000, Number(match[0]));
  const chinese = '零一二三四五六七八九十'.indexOf(String(value ?? '')[0]);
  return chinese >= 0 ? chinese : 0;
};
export function productLetter(index) {
  let result = '', value = index + 1;
  while (value > 0) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

/** 模型字段格式纠正，时段按整数边界连接，从0到向上取整的结尾，不改原对象。 */
export function productPlanFromReply(reply, duration, userText) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) throw Error(`拆解回话不是JSON对象：${JSON.stringify(reply)}`);
  const unsure = list(reply.unsure).map(text).filter(Boolean);
  const productRows = rowList(reply.products).filter(row => text(row.name));
  const renames = new Map();
  for (const [index, row] of productRows.entries()) if (row.id && !renames.has(row.id)) renames.set(row.id, productLetter(index));
  const references = value => text(value).replace(/商品([A-Za-z][A-Za-z\d_-]*)/g, (whole, id) => renames.has(id) ? `商品${renames.get(id)}` : whole);
  const products = productRows.map((row, index) => ({
    id: productLetter(index), name: text(row.name), look: text(row.look), pairs: count(row.pairs), pieces: count(row.pieces), layout: references(row.layout),
    ...(text(row.where) ? { where: [...text(row.where)].slice(0, 8).join('') } : {})
  }));
  if (!products.length) {
    products.push({ id: 'A', name: userText, look: '', pairs: 0, pieces: 0, layout: '' });
    unsure.push(`拆解没认出${userText}，请核一眼`);
  }
  const lookRows = rowList(reply.looks).filter(row => text(row.what));
  const looks = lookRows.map((row, index) => ({ id: `L${index + 1}`, kind: row.kind === 'outfit' ? 'outfit' : 'scene',
    what: text(row.what), now: text(row.now), target: text(row.target) }));
  // 合法编号保留便于存档对照，撞号与不安全编号重编。
  const seen = new Set();
  for (let i = 0; i < looks.length; i++) {
    const source = lookRows[i]?.id;
    if (typeof source === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(source) && !seen.has(source)) looks[i].id = source;
    while (seen.has(looks[i].id)) looks[i].id += '_2';
    seen.add(looks[i].id);
  }
  const end = Math.ceil(duration);
  const rows = rowList(reply.timeline).filter(row => text(row.action)).map(row => ({
    from: Number.isFinite(Number(row.from)) ? Math.max(0, Math.min(end - 1, Math.floor(Number(row.from)))) : 0,
    action: references(row.action)
  })).sort((a, b) => a.from - b.from);
  const starts = rows.filter((row, index) => rows.findIndex(other => other.from === row.from) === index);
  if (!starts.length) starts.push({ from: 0, action: '按参考视频完成动作' });
  starts[0] = { ...starts[0], from: 0 };
  const timeline = starts.map((row, index) => ({ from: row.from, to: starts[index + 1]?.from ?? end, action: row.action }));
  return { products, visible: text(reply.visible), face: reply.face === true || reply.face === 'true', looks, timeline, unsure };
}

export async function analyzeProduct(input, { sheets, ask }) {
  const { duration, ratio, userText } = input;
  const { images, cuts, frames, times } = await analysisImages(input, sheets);
  const reply = await ask({ round: 'analyze', context: { duration, ratio, userText }, images,
    text: '看总览大图：整条每0.2秒一帧，按时间从左到右、从上到下，每行10帧，左上角是秒数。名字结合总览里怎么动、与什么接触来认。'
      + `另附${frames.length}张清楚大帧，依次为${times.join('、')}秒，帮助看清细节。只回答下面这些：`
      + 'products只列符合用户原话的商品，按实物组分：颜色或款式不同各算一组，同款同色摆在不同位置也各算一组（例：脚上穿的一双、后排上层一双、后排下层一双是三组），被拿起、穿上的始终是同一组；'
      + 'id从A起，A是主角（被拿起、穿上、特写最多的那组）；where写这组在哪，不超过8个字（如脚上、后排上层、台面左边），不写颜色品牌；name写用户原话里的品类词（如鞋子、靴子、包），不写品牌、型号、颜色、款式；'
      + 'look这组原片外观；pairs/pieces只数这一组，只见到一只就pairs写0、pieces写1；layout只写这组摆在哪、和什么接触、什么时候被拿起或穿上，不写颜色、品牌、秒数。'
      + 'visible只写身体部位，用顿号隔开，不写颜色、首饰和时间；face是否露脸。looks列持续可见的大面积场景和穿搭首饰，kind为scene/outfit，what只写名称（不带颜色和品牌）、now原外观、target目标外观。'
      + '保留类别和位置，只换颜色或材质，一眼能看出不同，用日常配色、不默认鲜绿；商品不进looks；target不写品牌标志，也不写增加、加上、去掉、替换、改成这类词。'
      + 'timeline按整段写关键动作与商品状态：拿起、穿入、放下、停顿、结尾；from/to用整数秒覆盖全片；'
      + 'action只写手脚动作、商品摆在哪、镜头怎么动，不写商品和场景的颜色、品牌、图案、材质，也不写别的秒数。没把握写unsure。'
      + '只输出JSON：{products:[{id,name,where,look,pairs,pieces,layout}],visible,face,looks:[{id,kind,what,now,target}],timeline:[{from,to,action}],unsure:[文字]}。'
      + `\n${JSON.stringify({ duration, ratio, userText })}` });
  return { plan: productPlanFromReply(reply, duration, userText), cuts };
}
