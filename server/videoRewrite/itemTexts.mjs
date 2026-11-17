// 11-16 衣服卡、东西卡（道具 / 遮挡物 / 其他）「不出图，用文字」（设计 docs/specs/2026-11-16-衣服卡和东西卡用文字-design.md）。
// 和背景卡那套（sceneTexts.mjs）并排：卡上写大白话，定稿时交给本机 agent 对照原片写成画面描述。11-16 三条视频 13 张卡实测都写对。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneTextMark } from './writePrompt.mjs';

export const MAX_ITEM_TEXT = 300;
export const TEXT_KINDS = ['衣服', '道具', '遮挡物', '其他'];

/** 实测那版说明；第 6 条末尾「不带秒数」是实测后加的（棒球那条补的句子带了「4-6秒」，被规则当成时间轴第一段）。 */
export const ITEM_TEXT_EXTRA = `补充（卡片改用文字）：这次有几张卡用户没给图，点了「不出图，用文字」，在卡上用大白话写了要求，见「卡片要求.txt」，衣服卡附原片那一刻的截图。衣服卡在底稿里是占位「身穿【衣服 N 用文字】」；东西卡（道具 / 遮挡物 / 其他）底稿没写。
对这些卡：
1. 先看截图和原片连拍弄清原片里这套衣服 / 这样东西是什么样、谁穿着或拿着、在哪几秒；再按用户的话写：用户提到的以用户为准，用户没提到的照原片。
2. 衣服卡：在它管的每一段时间轴里，把占位换成这套衣服的画面描述（款式、长短、颜色、花纹、材质、鞋帽配饰），写在穿它的那个人身上；同一套衣服各段说法一致，第一次出现写全，后面可以只写它的名字。
3. 东西卡：在这样东西出现的时间段里写清它是什么（名字、颜色、材质）、在谁手里或在人物哪里；它怎么动跟随 @视频1，不另写。
4. 写成画面描述：不写「改为 / 换成 / 替换」这类改动口气，不提原片里原来是什么；被用户的话换掉的衣服 / 东西，全文其他句子里也不能再出现原来那样。
5. 这些卡没有图，不给它们编 @图片 编号；占位「【… 用文字】」必须全部换成画面描述，一个都不能留。
6. 用户要的样子和动作参考（@视频1）里的轮廓差很多时（长裙变短裤、要拿掉的帽子 / 头纱还有轮廓、东西大小形状差很多），在 @视频1 那句末尾补「不采用其中的××」，同时列进 unfixable，提醒可能压不住；补的这句不带秒数。
7. 拿掉东西也用正向写法写画面里是什么，不写「没有××」。
在 changes 里逐张写清你是怎么理解用户那句话的；输出的 JSON 另加 "sceneReads":[{"title":"卡名","read":"一句话：你把用户那句话理解成什么、最后写成什么样"}]，每张卡一条（背景卡也用文字时写在同一个数组里）。`;

/**
 * [{ title, itemId, text }]：itemId 要是拆解单里的衣服 / 道具 / 遮挡物 / 其他；同一项不能写两次，也不能同时连着图。
 */
export function checkItemTexts(value, plan, materials) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 30) throw Error('卡上的字格式不对；这次没发出去。');
  const seen = new Set();
  return value.map(row => {
    const title = typeof row?.title === 'string' ? row.title.trim().slice(0, 40) : '';
    const text = typeof row?.text === 'string' ? row.text.trim() : '';
    if (!title) throw Error('卡上的字缺了卡名；这次没发出去。');
    if (!text) throw Error(`${title} 选了用文字，还没写字。`);
    if (text.length > MAX_ITEM_TEXT) throw Error(`${title} 的字最多 ${MAX_ITEM_TEXT} 个。`);
    const item = (plan?.items ?? []).find(entry => entry.id === row.itemId);
    if (!item || !TEXT_KINDS.includes(item.kind)) throw Error(`${title} 对不上拆解单里的衣服或东西，请重新做一次视频改写。`);
    if (seen.has(item.id)) throw Error(`${title} 这一项写了两次字，留一张。`);
    seen.add(item.id);
    if (materials.some(material => material.itemId === item.id)) throw Error(`${title} 同时有图和字，留一样。`);
    return { title, itemId: item.id, text };
  });
}

const fileSafe = title => title.replace(/\s+/g, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '_');
const span = item => `${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10} 秒`;

/**
 * 每张卡对应拆解单哪一项、管哪几秒、谁穿。衣服卡按这套衣服的 frame 截一张原片；
 * 东西卡不截：拆解单给东西记的 frame 不可靠（11-16 婚礼花球记 0 秒、截出来纯黑），靠原片连拍找。
 */
export function itemTextRows(itemTexts, plan, seconds) {
  const items = plan?.items ?? [];
  return itemTexts.map(row => {
    const item = items.find(entry => entry.id === row.itemId), again = items.filter(entry => entry.sameAs === row.itemId);
    if (item?.kind !== '衣服') return { ...row, item, again };
    const frame = Number.isFinite(item.frame) ? item.frame : item.from;
    const second = Math.round(Math.max(0, Math.min(frame, seconds - 0.15)) * 10) / 10;
    return { ...row, item, again, second, file: `${fileSafe(row.title)}_原片${second.toFixed(1)}s.jpg` };
  });
}

export function itemTextNote(rows, plan) {
  return rows.map(row => {
    if (row.item.kind !== '衣服') return `${row.title}（东西卡，拆解单 ${row.item.id}，原片里 ${span(row.item)}）：用户写「${row.text}」。没有单独截图，在原片连拍里找它。`;
    const person = (plan?.items ?? []).find(entry => entry.id === row.item.person);
    const who = person ? `${person.where ? `${person.where}的` : ''}人物 ${person.id} 穿，` : '';
    return `${row.title}（衣服卡，${who}管 ${[row.item, ...row.again].map(span).join(' 和 ')}，拆解单 ${[row.item, ...row.again].map(entry => entry.id).join(' / ')}）：`
      + `用户写「${row.text}」。原片截图：${row.file}`;
  }).join('\n');
}

export async function itemTextFiles(rows, plan, sourcePath, folder, sheets) {
  const files = [];
  for (const [index, row] of rows.entries()) {
    if (!row.file) continue;
    const dir = join(folder, `item-text-${index}`);
    mkdirSync(dir, { recursive: true });
    const [name] = await sheets.frames({ source: sourcePath, folder: dir }, [row.second], { maxSide: 720 });
    files.push({ name: row.file, buffer: readFileSync(join(dir, name)) });
  }
  return [...files, { name: '卡片要求.txt', buffer: Buffer.from(itemTextNote(rows, plan)) }];
}

/** 假模式只为点通页面：衣服占位直接换成原话，东西卡的原话接在第一段末尾。 */
export function fakeItemTexts(prompt, itemTexts, plan) {
  const things = [];
  let text = itemTexts.reduce((draft, row) => {
    const mark = sceneTextMark(row.title);
    if (!draft.includes(mark) && plan.items.find(item => item.id === row.itemId)?.kind !== '衣服') things.push(`${row.title}（用户写：${row.text}）`);
    return draft.split(mark).join(`（用户写：${row.text}）`);
  }, prompt);
  if (things.length) {
    const lines = text.split('\n'), first = lines.findIndex(line => /^\d+-\d+秒：/.test(line));
    if (first >= 0) lines[first] = lines[first].replace(/。?$/, `，${things.join('，')}。`);
    text = lines.join('\n');
  }
  return text;
}
