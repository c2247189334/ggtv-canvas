import { EDIT_WORDS, originalDescriptionMatch } from '../videoRewrite/rules.mjs';
import { productIdOf, productPhrase } from './lookProducts.mjs';

const sentence = value => String(value ?? '').trim().replace(/[。；;]+$/, '');
const COLOR = /[浅深暗亮淡雾霾奶米金银酒玫紫粉红橙黄绿青蓝黑白灰棕褐驼咖啡卡其香槟焦糖杏]+色/g;
const SHADES = '色浅深暗亮淡雾霾';
const LATIN = /[A-Za-z][A-Za-z\d]+/g;
const RANGE = /\d+(?:\.\d+)?\s*秒?\s*[-—–~～至到]\s*\d+(?:\.\d+)?\s*秒/, DECIMAL = /\d+\.\d+\s*秒/;
const clauses = value => sentence(value).split(/[，,；;。]+/).map(part => part.trim()).filter(Boolean);

/**
 * 原片外观（商品 look、场景 now / what）里的品牌字母串和颜色字。
 * 11-04 真拆：拆解把 adidas、亮片鞋头、驼色、紫红脚垫写进摆位 / 动作 / 露出部位，整段比对拦不住，改成按小句剔。
 */
function originalTerms(plan) {
  const texts = [...plan.products.map(row => row.look), ...plan.looks.flatMap(row => [row.now, row.what])].map(String);
  const latin = new Set(texts.flatMap(text => text.match(LATIN) ?? []).map(word => word.toLowerCase()));
  const roots = new Set(texts.flatMap(text => text.match(COLOR) ?? []).flatMap(color => [...color]).filter(char => !SHADES.includes(char)));
  const leaks = part => (part.match(LATIN) ?? []).some(word => latin.has(word.toLowerCase()))
    || (part.match(COLOR) ?? []).some(color => [...color].some(char => roots.has(char)));
  const strip = value => String(value ?? '').replace(LATIN, word => latin.has(word.toLowerCase()) ? '' : word).replace(COLOR, '').replace(/\s+/g, ' ').trim();
  return { leaks, strip };
}

const countText = ({ pairs, pieces }) => pairs && pieces === pairs * 2 ? `${pairs} 双 ${pieces} 只` : pieces ? `${pieces} 只` : pairs ? `${pairs} 双` : '';

/** 五段模板，原片外观只参与过滤，不进入正文。 */
export function writeProductPrompt({ plan, materials, model, duration, userText }, looks = {}) {
  const originals = [...plan.products.map(row => row.look), ...plan.looks.map(row => row.now)];
  const safe = value => {
    const phrase = sentence(value);
    return EDIT_WORDS.some(word => phrase.includes(word)) || originals.some(desc => originalDescriptionMatch(phrase, desc)) ? '' : phrase;
  };
  const { leaks, strip } = originalTerms(plan);
  // 编辑词、原描述只剔所在小句；describe 再剔原片品牌颜色和时间段、小数秒（免费检查会把它们当时间轴）。
  const keep = value => clauses(value).filter(part => safe(part)).join('，');
  const describe = value => clauses(value).filter(part => safe(part) && !leaks(part) && !RANGE.test(part) && !DECIMAL.test(part)).join('，');
  const user = productPhrase(userText, 20);
  const nameOf = product => {
    const name = safe(productPhrase(product.name));
    if (name && (user.includes(name) || ([...name].length <= 4 && !leaks(name) && !name.match(LATIN)))) return name;
    return user && [...user].length <= 10 ? user : '商品';
  };
  // 11-10 用户定统一按官方 2.5：用官方示例「严格参考…顺序与视频保持一致」（2.5 指南第 198 行）。
  const lines = ['@视频1 是参考视频：严格参考它的动作、手脚和商品的接触、运镜、构图和场景布局，顺序和节奏与视频保持一致。'];
  const warnings = [...plan.unsure];
  const background = materials.find(row => row.tag.startsWith('@图片') && row.role === 'background');
  const tagsOf = id => materials.filter(row => row.tag.startsWith('@图片') && productIdOf(row) === id).map(row => row.tag);
  // 11-04 晚起按实物组分：组名带位置；「跟商品A一样」的组不占图片号，照被跟那组的图。
  const whereOf = product => { const where = safe(productPhrase(product.where, 8)); return where && !leaks(where) ? where : ''; };
  const groupLabel = product => `商品${product.id}${whereOf(product) ? `，${whereOf(product)}那组` : ''}`;
  const kin = product => plan.products.filter(other => nameOf(other) === nameOf(product)).map(other => `商品${other.id}`);
  for (const product of plan.products) {
    const tags = tagsOf(product.id), label = `商品${product.id}`, name = nameOf(product), unit = kin(product).length > 1 ? '组' : '款';
    const same = !tags.length && product.sameAs ? tagsOf(product.sameAs) : [];
    if (same.length) {
      lines.push(`${label}（${groupLabel(product).slice(label.length + 1) || '另一组'}）和商品${product.sameAs}同款同色：外观、颜色和结构也只照 ${same.join('、')}，不采用 @视频1 里原来那${unit}${name}的外观。`);
      continue;
    }
    if (!tags.length) continue;
    const multi = tags.length > 1;
    let line = `${tags.join('、')} 是${multi ? '同一款' : ''}${name}（${groupLabel(product)}）${multi ? '的不同角度' : ''}：`
      + `${label}的外观、颜色和结构只照${multi ? '这几张图' : '这张图'}，不采用 @视频1 里原来那${unit}${name}的外观，也不采用图里的人、衣服和背景。`;
    const features = safe(productPhrase(looks[product.id]?.features));
    const wear = ['直接套脚', '要系带'].includes(looks[product.id]?.wear) ? looks[product.id].wear : '';
    if (features) line += `${label}：${features}${wear ? `；${wear}` : ''}。`;
    else if (wear) line += `${label}：${wear}。`;
    lines.push(line);
    if (tags.length === 1) warnings.push(`${label}只有 1 张图，建议补充不同角度的实物照`);
  }
  if (background) lines.push(`${background.tag} 是场景：场景的颜色、材质和光线照它，布局和机位照 @视频1。`);
  const quantities = plan.products.map(product => {
    const counts = countText(product), layout = describe(product.layout), where = whereOf(product);
    return `商品${product.id}${where ? `（${where}）` : ''}${counts ? `全片共 ${counts}` : '数量照参考视频'}${layout ? `；${layout}` : ''}`;
  });
  const all = [...new Map(plan.products.map(product => [nameOf(product), kin(product)])).entries()].filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => `画面里的${name}只有${ids.join('、')}这 ${ids.length} 组，每组照各自的图，不出现 @视频1 里原来的${name}。`).join('');
  lines.push(`数量和摆位：${quantities.join('；')}。${all}`);
  const changes = plan.looks.filter(row => !background || row.kind === 'outfit')
    .map(row => { const target = productPhrase(keep(row.target), 200), what = safe(productPhrase(strip(row.what))); return target && what ? `${what}是${target}` : ''; }).filter(Boolean);
  if (changes.length) lines.push(`外观：${changes.join('；')}。`);
  const end = Math.ceil(duration ?? plan.timeline.at(-1)?.to ?? 4);
  const timeline = plan.timeline.filter(row => row.from < end).map(row => ({ ...row, to: Math.min(row.to, end) }));
  if (!timeline.length) timeline.push({ from: 0, to: end, action: '按参考视频完成动作' });
  timeline[timeline.length - 1].to = end;
  lines.push(`${timeline.map(row => `${row.from}-${row.to} 秒：${describe(row.action) || '按参考视频完成动作'}`).join('；')}。`);
  // 露出部位只留第一句的身体部位：括号里的首饰颜色、分号后的时间说明都不要。
  const body = String(plan.visible ?? '').replace(/[（(][^）)]*[）)]/g, '').split(/[；;。]/)[0];
  const visible = productPhrase(body.split(/[、，,]/).map(part => part.trim()).filter(part => part && safe(part) && !leaks(part)).join('、'), 100)
    .replace(/^画面里|^只露出|^只有|^仅有/g, '');
  lines.push(`同一商品每次出现都保持一样；画面里只露出${visible || '商品和手脚'}，不出现人脸；不要字幕。`);
  if (plan.face) warnings.push('原片可能露脸，交单可能被火山拦');
  if (/2-0/.test(model ?? '')) warnings.push('2.0 可能不认秒数，时间轴只作参考');
  return { videoPrompt: lines.join('\n'), warnings: [...new Set(warnings)] };
}
