import { validatePlan } from './analyze.mjs';
import { outfitChangePoints, sceneChangePoints, sceneItems, targetDuration } from './rules.mjs';
import { isNewScene, itemLabel, itemTextOf, labelPeers, materialRoles, MESH_PURPOSE } from './roles.mjs';

const THINGS = ['道具', '遮挡物', '其他'];
const KEEP_CLOTHES = /衣服(?:不换|不变|别换|不要换|照旧|保留|保持|还用原)|(?:保留|保持|不换|别换|不要换)(?:原来的|原视频的|原)?衣服|只换(?:脸|人脸|头)|换脸/;
// 11-10：说「程序底稿没写」而不是「提示词没写」——本机 agent 定稿时会按原片把被人拿着的东西补进去（finalPrompt 清单第 5 条）。
const thingsNote = names => `拆解认出画面里还有${names.join('、')}：程序底稿没写；成片里少了或摆错，再自己补一句。`;
const newSceneThingsNote = names => `拆解认出原片里还有${names.join('、')}：换了新背景、程序底稿也没写，成片里可能没有；要留哪样，自己在提示词里补一句。`;
const meshThingsNote = names => `拆解认出画面里还有${names.join('、')}：程序底稿没写，成片里可能少了或摆错；在意就自己补一句。`;

/** 10-30 用户定：背景图和视频比例差一成以上就提醒（不拦）；读不出尺寸（不是 PNG / JPEG）不提醒。 */
export function sceneRatioNotes(ratio, size) {
  if (!size?.width || !size?.height) return [];
  const [w, h] = ratio.split(':').map(Number);
  if (Math.abs(Math.log((size.width / size.height) / (w / h))) <= Math.log(1.1)) return [];
  return [`背景图是 ${size.width}×${size.height}，和视频 ${ratio} 的比例差得多，成片里背景可能被裁掉一块或补出来；建议换一张比例相近的图，或在背景卡里重新生成。`];
}
/** 11-13 背景卡用文字的占位（和 rules.mjs 的残留检查、finalPrompt 的说明一起改）。 */
export const sceneTextMark = title => `【${title} 用文字】`;
const outfitsNote = count =>`原视频有${count}套衣服在换装，提示词照原视频写了换装；人物图里自己穿的衣服没用上。`;

/**
 * 10-30 功夫舞真成片：只说「人物换掉」时照原视频写衣服，大爷穿了女生的舞蹈服。改成：连了一张要换的人物图、没连衣服图、
 * 原话没说衣服不换、看图说人物图不是纯色打底衣服（出图模板那种占位）→ 衣服也照人物图。原片在换装就保留换装（换装点要单独一秒段），只提醒。
 * 11-06 用户：只写换人时衣服要跟原片。勾了「衣服和原片保持一致」（keepClothes）就不走这条，衣服卡删了也不穿人物图那身。
 * 11-16：有衣服卡改用文字（itemTexts）也算有衣服安排，不然卡上的字会被人物图那身顶掉。
 */
export function personOutfit({ plan, materials, userText = '', keepClothes = false, itemTexts = [] }, looks = {}) {
  const kindOf = id => plan.items.find(item => item.id === id)?.kind;
  const people = materials.filter(row => kindOf(row.itemId) === '人物' && plan.replace.includes(row.itemId));
  if (keepClothes || people.length !== 1 || [...materials, ...itemTexts].some(row => kindOf(row.itemId) === '衣服') || KEEP_CLOTHES.test(userText)
    || looks[people[0].tag]?.plainClothes) return null;
  const outfits = plan.items.filter(item => item.kind === '衣服').length;
  return { tag: people[0].tag, clothes: looks[people[0].tag]?.clothes ?? '', changing: outfitChangePoints(plan).length ? outfits : 0 };
}

/**
 * 10-30 用户定：最终提示词由代码按固定模板拼，不再让模型写整段（10-27 文字和深度视频打架多扫一段扇叶、凭空写机位、每次写得不一样）。
 * 只写深度视频给不了的：谁换成哪张图、每套衣服哪段时间穿；机位、动作、东西几秒动全跟随深度视频。
 * 10-30 两条真成片都被「画面里还有：名字（外观），跟随视频」带偏（多出原片没有的球杆套、猫换了位置）：底稿不写东西，只在提醒里列名字。
 * 11-10 用户定：东西写不写以原片为准、不交给深度视频（举杯喝的杯子在深度里和脸糊成一块，没写就丢了）——代码看不到图，交给定稿时看原片判断。
 * looks 是小服务看人物图回答固定问题的结果（lookPeople），没有就当人物图穿着自己的衣服、不带描述。
 * 11-06 用户定：原片换地方也要能复刻，结尾不再写死同一个场景。有多个场景时每段写清场景，换场点和换装点一样单独占一秒段；两个人时谁穿哪件分开写。
 */
export function writePrompt(input, looks = {}) {
  const { plan, materials } = input;
  validatePlan(plan, input.sourceDuration ?? input.duration);
  const total = targetDuration(input.duration);
  const depth = materials.find(material => material.tag.startsWith('@视频'))?.tag;
  const tagOf = id => materials.find(material => material.itemId === id)?.tag;
  const peers = labelPeers(input);
  // 11-16：用文字的东西卡由定稿按卡上的字写，不进「底稿没写」的提醒。
  const names = plan.items.filter(item => THINGS.includes(item.kind) && !plan.replace.includes(item.id) && !itemTextOf(input.itemTexts, item)).map(item => item.desc.split(/[，,]/)[0].trim());
  const outfit = personOutfit(input, looks), wearing = outfit && !outfit.changing ? outfit : null;
  const clothes = plan.items.filter(item => item.kind === '衣服');
  // 要换却没连图的衣服只写称呼，不带回原视频的样子。
  // 11-06：隔一段穿回同一套（sameAs）只有一张图。
  const clothTag = item => tagOf(item.id) ?? (item.sameAs ? tagOf(item.sameAs) : undefined);
  // 11-11 婚礼：衣服跟原片又没连图时原描述每段重抄（15 秒约 1500 字）。先放记号，拼完再换：每套第一次出现写全，后面只写开头那个名字。
  const own = item => clothes.find(entry => entry.id === item.sameAs) ?? item;
  // 11-16 衣服卡用文字：写占位，定稿时由本机 agent 按卡上的字换成画面描述（隔一段穿回的同一套共用一个占位）。
  const look = item => clothTag(item) ? `${clothTag(item)}的衣服` : itemTextOf(input.itemTexts, item) ? sceneTextMark(itemTextOf(input.itemTexts, item).title)
    : plan.replace.includes(item.id) ? itemLabel(item, peers).replace(/（.*）$/, '') : `\u0000${own(item).id}\u0000`;
  const once = text => {
    const seen = new Set();
    return text.replace(/\u0000([^\u0000]+)\u0000/g, (_, id) => {
      const desc = clothes.find(entry => entry.id === id).desc;
      if (seen.has(id)) return desc.split(/[，,]/)[0].trim();
      seen.add(id); return desc;
    });
  };
  const people = plan.items.filter(item => item.kind === '人物'), scenes = sceneItems(plan), moving = scenes.length > 1;
  const wearers = [...new Set(clothes.map(item => item.person ?? ''))];
  const nameOf = id => { const person = people.find(item => item.id === id); return person ? tagOf(id) ?? person.desc.split(/[，,]/)[0].trim() : '人物'; };
  /** 这个人此刻穿的：开始秒数不晚于此刻的最后一套（两个人常差零点几秒才换）。 */
  const wornBy = (person, second) => {
    const worn = clothes.filter(item => (item.person ?? '') === person && item.from <= second), latest = Math.max(...worn.map(item => item.from));
    return worn.filter(item => item.from === latest).map(look).join('和');
  };
  const wear = second => wearers.length > 1
    ? wearers.flatMap(person => wornBy(person, second) ? [`${nameOf(person)}身穿${wornBy(person, second)}`] : []).join('，')
    : `身穿${wornBy(wearers[0], second)}`;
  // 11-13 背景卡用文字：这一段写占位，定稿时由本机 agent 结合原片截图和卡上的字换成画面描述（规则查占位残留）。
  const textOf = id => { const row = (input.sceneTexts ?? []).find(entry => entry.sceneId === id); return row ? sceneTextMark(row.title) : undefined; };
  const place = second => { const scene = scenes.filter(item => item.from <= second).at(-1) ?? scenes[0]; return `场景是${tagOf(scene.id) ?? textOf(scene.id) ?? scene.desc}，`; };
  /** after：「随后」后面的半句，一个人又不换场时省掉重复的「人物」。 */
  const state = (second, after = false) => {
    const where = moving ? place(second) : '';
    if (wearing) return `${where}人物身穿${wearing.tag}里的衣服${wearing.clothes ? `（${wearing.clothes}）` : ''}`;
    if (!clothes.length) return `${where}人物${depth ? `的动作跟随${depth}` : '前后一致'}`;
    return `${where}${wearers.length > 1 || (after && !moving) ? '' : '人物'}${wear(second)}`;
  };
  const points = [...(clothes.length && !wearing ? outfitChangePoints(plan) : []), ...sceneChangePoints(plan)]
    .filter(point => Math.floor(point.second) + 1 <= total).sort((a, b) => a.second - b.second);
  const lines = [], timing = moving ? '切换时机' : '换装时机';
  let cursor = 0, opened = '', current = total;
  for (const { second, start } of points) {
    const at = Math.floor(second);
    // 同一秒里换两次：并成一段，从这一秒开头的样子直接写到最后一次换完。
    if (at < cursor) lines.pop(); else { opened = state(start - 0.001); if (at > cursor) lines.push(`${cursor}-${at}秒：${opened}。`); }
    lines.push(`${at}-${at + 1}秒：${opened}，随后${state(start, true)}${depth ? `，${timing}跟随${depth}` : ''}。`);
    cursor = at + 1; current = start;
  }
  if (cursor < total) lines.push(`${cursor}-${total}秒：${state(current)}。`);
  const crowd = people.length > 1 ? `这${people.length}个人` : '同一个人';
  // 11-11：拆解没分场景不等于没换地方（婚礼每次换装都换了地方），有换装点就不写死「同一个场景」，交给定稿看原片写。
  const closing = moving ? `全程${crowd}，场景和光线按上面每段来，不要字幕。` : points.length ? `全程${crowd}，不要字幕。` : `全程${crowd}、同一个场景和光线，不要字幕。`;
  const mesh = materials.some(material => material.tag.startsWith('@视频') && material.purpose === MESH_PURPOSE);
  const note = mesh ? meshThingsNote : isNewScene(materials) ? newSceneThingsNote : thingsNote;
  const warnings = [...plan.unsure.map(text => `拆解没把握：${text}`), ...(outfit?.changing ? [outfitsNote(outfit.changing)] : []),
    ...(names.length ? [note(names)] : [])];
  if (mesh) {
    const missing = [...new Set(plan.items.filter(item => ['道具', '遮挡物'].includes(item.kind))
      .map(item => item.desc.split(/[，,]/)[0].trim()).filter(Boolean))];
    if (missing.length) warnings.push(`白模里没有${missing.join('、')}，成片里它怎么动只能靠模型猜；在意就改用深度`);
  }
  const roles = materialRoles(input, { looks, wearPerson: Boolean(wearing) });
  return { videoPrompt: [roles, once(lines.join('\n')), closing].join('\n'), warnings };
}
