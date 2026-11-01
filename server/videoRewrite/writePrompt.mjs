import { validatePlan } from './analyze.mjs';
import { outfitChangePoints, targetDuration } from './rules.mjs';
import { isNewScene, itemLabel, materialRoles, MESH_PURPOSE } from './roles.mjs';

const THINGS = ['道具', '遮挡物', '其他'];
const KEEP_CLOTHES = /衣服(?:不换|不变|别换|不要换|照旧|保留|保持|还用原)|(?:保留|保持|不换|别换|不要换)(?:原来的|原视频的|原)?衣服|只换(?:脸|人脸|头)|换脸/;
const thingsNote = names => `拆解认出画面里还有${names.join('、')}：提示词没写，交给背景图和深度视频；成片里少了或摆错，再自己补一句。`;
const newSceneThingsNote = names => `拆解认出原片里还有${names.join('、')}：换了新背景、提示词也没写，成片里可能没有；要留哪样，自己在提示词里补一句。`;
const meshThingsNote = names => `拆解认出画面里还有${names.join('、')}：提示词没写，成片里可能少了或摆错；在意就自己补一句。`;

/** 10-30 用户定：背景图和视频比例差一成以上就提醒（不拦）；读不出尺寸（不是 PNG / JPEG）不提醒。 */
export function sceneRatioNotes(ratio, size) {
  if (!size?.width || !size?.height) return [];
  const [w, h] = ratio.split(':').map(Number);
  if (Math.abs(Math.log((size.width / size.height) / (w / h))) <= Math.log(1.1)) return [];
  return [`背景图是 ${size.width}×${size.height}，和视频 ${ratio} 的比例差得多，成片里背景可能被裁掉一块或补出来；建议换一张比例相近的图，或在背景卡里重新生成。`];
}
const outfitsNote = count => `原视频有${count}套衣服在换装，提示词照原视频写了换装；人物图里自己穿的衣服没用上。`;

/**
 * 10-30 功夫舞真成片：只说「人物换掉」时照原视频写衣服，大爷穿了女生的舞蹈服。改成：连了一张要换的人物图、没连衣服图、
 * 原话没说衣服不换、看图说人物图不是纯色打底衣服（出图模板那种占位）→ 衣服也照人物图。原片在换装就保留换装（换装点要单独一秒段），只提醒。
 */
export function personOutfit({ plan, materials, userText = '' }, looks = {}) {
  const kindOf = id => plan.items.find(item => item.id === id)?.kind;
  const people = materials.filter(row => kindOf(row.itemId) === '人物' && plan.replace.includes(row.itemId));
  if (people.length !== 1 || materials.some(row => kindOf(row.itemId) === '衣服') || KEEP_CLOTHES.test(userText)
    || looks[people[0].tag]?.plainClothes) return null;
  const outfits = plan.items.filter(item => item.kind === '衣服').length;
  return { tag: people[0].tag, clothes: looks[people[0].tag]?.clothes ?? '', changing: outfitChangePoints(plan).length ? outfits : 0 };
}

/**
 * 10-30 用户定：最终提示词由代码按固定模板拼，不再让豆包写整段（10-27 文字和深度视频打架多扫一段扇叶、凭空写机位、每次写得不一样）。
 * 只写深度视频给不了的：谁换成哪张图、每套衣服哪段时间穿；机位、动作、东西几秒动全跟随深度视频。
 * 10-30 两条真成片都被「画面里还有：名字（外观），跟随视频」带偏（多出原片没有的球杆套、猫换了位置）：东西不写，只在提醒里列名字。
 * looks 是小服务看人物图回答固定问题的结果（lookPeople），没有就当人物图穿着自己的衣服、不带描述。
 */
export function writePrompt(input, looks = {}) {
  const { plan, materials } = input;
  validatePlan(plan, input.sourceDuration ?? input.duration);
  const total = targetDuration(input.duration);
  const depth = materials.find(material => material.tag.startsWith('@视频'))?.tag;
  const tagOf = id => materials.find(material => material.itemId === id)?.tag;
  const replaced = plan.items.filter(item => plan.replace.includes(item.id));
  const names = plan.items.filter(item => THINGS.includes(item.kind) && !plan.replace.includes(item.id)).map(item => item.desc.split(/[，,]/)[0].trim());
  const outfit = personOutfit(input, looks), wearing = outfit && !outfit.changing ? outfit : null;
  const clothes = plan.items.filter(item => item.kind === '衣服');
  // 要换却没连图的衣服只写称呼，不带回原视频的样子。
  const look = item => tagOf(item.id) ? `${tagOf(item.id)}的衣服`
    : plan.replace.includes(item.id) ? itemLabel(item, replaced).replace(/（.*）$/, '') : item.desc;
  const wear = start => `身穿${clothes.filter(item => item.from === start).map(look).join('和')}`;
  const lines = [];
  if (wearing) lines.push(`0-${total}秒：人物身穿${wearing.tag}里的衣服${wearing.clothes ? `（${wearing.clothes}）` : ''}。`);
  else if (!clothes.length) lines.push(`0-${total}秒：人物${depth ? `的动作跟随${depth}` : '前后一致'}。`);
  else {
    let cursor = 0, current = Math.min(...clothes.map(item => item.from)), opened = current;
    const points = outfitChangePoints(plan).filter(point => Math.floor(point.second) + 1 <= total).sort((a, b) => a.second - b.second);
    for (const { second, start } of points) {
      const at = Math.floor(second);
      // 同一秒里换两次：并成一段，从这一秒开头穿的那套直接写到最后一套。
      if (at < cursor) lines.pop(); else { if (at > cursor) lines.push(`${cursor}-${at}秒：人物${wear(current)}。`); opened = current; }
      lines.push(`${at}-${at + 1}秒：人物${wear(opened)}，随后${wear(start)}${depth ? `，换装时机跟随${depth}` : ''}。`);
      cursor = at + 1; current = start;
    }
    if (cursor < total) lines.push(`${cursor}-${total}秒：人物${wear(current)}。`);
  }
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
  return { videoPrompt: [roles, ...lines, '全程同一个人、同一个场景和光线，不要字幕。'].join('\n'), warnings };
}
