import { outfitChangePoints } from './rules.mjs';
import { MESH_PURPOSE } from '../mesh/purpose.mjs';
export { MESH_PURPOSE } from '../mesh/purpose.mjs';

/** 称呼只取种类、顺序和时段，绝不使用原视频外观。 */
export function itemLabel(item, items) {
  const peers = items.filter(entry => entry.kind === item.kind).sort((a, b) => a.from - b.from);
  const number = peers.findIndex(entry => entry.id === item.id) + 1;
  if (item.kind === '衣服') return `第${number}套衣服（${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10}秒穿）`;
  return `${item.kind}${peers.length > 1 ? number : ''}`;
}

/** 页面背景卡用途（和 src/domain/videoRewrite.ts 两边一起改）：用户没勾「背景和原片保持一致」，背景换成新场景。 */
export const NEW_SCENE_PURPOSE = '背景，换成新场景';
export const isNewScene = materials => materials.some(material => material.purpose === NEW_SCENE_PURPOSE);

/**
 * 10-30：背景不一定是房间（高尔夫是室外夜场）；只有一套衣服时不提换装节奏；深度视频管人物动作和所有东西的动静。
 * 10-30 用户定：背景换新场景时深度只管人物动作和机位，不采用原片的场景和东西（推测会和新背景打架，没真出片验证）。
 * 10-30 功夫舞真成片：深度里辫子轮廓很清楚，换了人就不采用深度的发型；looks 是看人物图的结果，wearPerson 时衣服也照人物图。
 */
export function materialRoles({ materials, plan }, { looks = {}, wearPerson = false } = {}) {
  const rhythm = outfitChangePoints(plan).length ? '动作和换装节奏' : '动作节奏';
  const connected = materials.flatMap(material => {
    const item = plan.items.find(entry => entry.id === material.itemId && plan.replace.includes(entry.id));
    return item ? [{ ...item, tag: material.tag }] : [];
  });
  const people = connected.filter(item => item.kind === '人物'), newScene = isNewScene(materials);
  return materials.map(material => {
    const { tag, purpose } = material;
    const item = connected.find(entry => entry.id === material.itemId);
    if (tag.startsWith('@音频')) return `${tag}是背景音乐，${rhythm}跟随它。`;
    if (tag.startsWith('@视频')) {
      if (purpose === MESH_PURPOSE) {
        const identity = people.length === 1 ? `；${tag}里的灰色人体模型就是${people[0].tag}` : people.length > 1
          ? `；${tag}里的${people.map(person => `${itemLabel(person, connected).replace('人物', '灰色人体模型')}就是${person.tag}`).join('，')}` : '';
        return `${tag}是白模参考：只采用人物的动作、姿态、位置和机位，不采用其中的灰色模型外观、材质和黑色背景${identity}。`;
      }
      const identity = people.length === 1 ? `；${tag}里的人就是${people[0].tag}` : people.length > 1
        ? `；${tag}里的${people.map(person => `${itemLabel(person, connected)}就是${person.tag}`).join('，')}` : '';
      const hair = people.length ? '、发型' : '';
      if (newScene) return `${tag}只采用人物的动作、姿态、位置和机位，不采用其中的场景、东西、灰度画面${hair}和衣服轮廓${identity}。`;
      return `${tag}只采用人物的动作、姿态、位置、机位，以及画面里东西的位置、动静和出现时机，不采用其中的灰度画面${hair}和衣服轮廓${identity}。`;
    }
    if (purpose.startsWith('背景') || item?.kind === '场景') return `${tag}是场景：只采用场景的布局、陈设、颜色和光线，不采用图中人物。`;
    const label = item ? itemLabel(item, connected) : '参考物品';
    if (item?.kind === '人物') {
      const look = looks[tag] ?? {}, hair = look.hair ? `发型（${look.hair}）` : '发型';
      const views = look.views > 1 ? `；图里${look.views}个身影是同一个人的不同角度，画面里只出现这一个人` : '';
      return wearPerson ? `${tag}是${label}：采用脸、${hair}、身材和衣服，不采用图中的背景${views}。`
        : `${tag}是${label}：只采用脸、${hair}和身材，不采用图中的衣服和背景${views}。`;
    }
    if (item?.kind === '衣服') return `${tag}是${label}：只采用衣服的款式、长短、颜色和材质，不采用图中的人台、模特和背景。`;
    return `${tag}是${label}：只采用它的外形、颜色和材质，不采用图中背景。`;
  }).join('\n');
}

export function imageTemplate(kind) {
  if (kind === '人物') return '（在这里写你想要的人物：性别、年龄、长相、发型），单人全身正面照，穿简单的纯色贴身衣服，纯色背景。';
  if (kind === '衣服') return '（在这里写你想要的衣服：颜色、款式、长短、材质），衣服平铺或无头人台展示，纯色背景，不出现人脸。';
  return '（在这里写你想要的样子：颜色、形状、材质），单独物品，纯色背景。';
}
