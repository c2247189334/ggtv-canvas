import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const validCardId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
const text = value => typeof value === 'string' && Boolean(value.trim());
const kinds = ['人物', '衣服', '场景', '道具', '遮挡物', '其他'];
const requireValue = (ok, message) => { if (!ok) throw Error(`改写单不合法：${message}`); };

/** 10-30 起拆解不问动作和变化（交给深度视频），actions / changes 可以空；旧卡带着照收。 */
export function validatePlan(plan, duration) {
  const second = n => Number.isFinite(n) && n >= 0 && n <= duration;
  requireValue(plan && typeof plan === 'object' && !Array.isArray(plan), '必须是JSON对象。');
  requireValue(text(plan.summary), 'summary必须是一句话。');
  for (const field of ['items', 'changes', 'actions', 'replace', 'unsure']) {
    requireValue(Array.isArray(plan[field]), `${field}必须是数组。`);
  }
  requireValue(plan.items.length > 0 && plan.items.length <= 100, 'items需要1到100项。');
  const ids = new Set();
  for (const item of plan.items) {
    requireValue(item && validCardId(item.id) && !ids.has(item.id), 'item的id必须安全且不重复。');
    ids.add(item.id);
    requireValue(kinds.includes(item.kind) && text(item.desc), 'item的kind或desc不对。');
    requireValue(second(item.from) && second(item.to) && item.to > item.from && second(item.frame)
      && item.frame >= item.from && item.frame <= item.to, 'item秒数必须在该项区间和视频时长内。');
  }
  requireValue(plan.changes.length <= 100, '变化点最多100个。');
  for (const change of plan.changes) requireValue(change && second(change.second) && text(change.how), '变化点的second或how不对。');
  requireValue(plan.actions.length <= 100, '动作最多100段。');
  for (const action of plan.actions) requireValue(action && second(action.from) && second(action.to)
    && action.to > action.from && text(action.desc), '动作时间轴不合法。');
  requireValue(plan.replace.every(id => typeof id === 'string' && ids.has(id)) && new Set(plan.replace).size === plan.replace.length, 'replace必须引用存在且不重复的item id。');
  requireValue(plan.unsure.every(text), 'unsure每项必须是文字。');
  return plan;
}

/** 豆包会给不同项起同一个编号（10-25 真测人物、道具都叫 P1）：后出现的改成没人用的「编号_2」，replace 仍指第一个；不动原回话。 */
export function uniqueItemIds(plan) {
  if (!Array.isArray(plan?.items)) return plan;
  const taken = new Set(plan.items.map(item => item?.id)), seen = new Set();
  const items = plan.items.map(item => {
    if (!item || !validCardId(item.id)) return item;
    if (!seen.has(item.id)) { seen.add(item.id); return item; }
    let n = 2;
    while (taken.has(`${item.id}_${n}`)) n++;
    const id = `${item.id}_${n}`;
    taken.add(id); seen.add(id);
    return { ...item, id };
  });
  return { ...plan, items };
}

/** 豆包会把 unsure 写成一段文字（10-26 晚真测 15 秒整条）：包成一项的数组；空文字、没写、null 当没有；别的样子原样交给校验拒；不动原回话。 */
export function unsureList(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan.unsure)) return plan;
  if (plan.unsure === undefined || plan.unsure === null) return { ...plan, unsure: [] };
  if (typeof plan.unsure === 'string') return { ...plan, unsure: plan.unsure.trim() ? [plan.unsure] : [] };
  return plan;
}

const rows = list => (Array.isArray(list) ? list : []).filter(row => row && typeof row === 'object' && !Array.isArray(row));
const number = value => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value);

/**
 * 10-30 窄拆解：豆包只回 people / clothes / things / replace，代码转成改写单（页面铺卡、写词照旧用）。
 * 格式毛病能纠正就纠正（钱已花）：秒数写成字符串转数字、越界夹回时长内、没写时段算全片、replace 写成一段字也认、不存在的编号去掉写进 unsure。
 */
export function planFromReply(reply, duration) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return reply;
  const clamp = (value, fallback) => { const n = number(value); return Number.isFinite(n) ? Math.min(Math.max(n, 0), duration) : fallback; };
  const item = (row, kind, timed) => {
    const from = timed ? clamp(row.from, 0) : 0;
    return { id: row.id, kind, desc: row.desc, from, to: timed ? clamp(row.to, duration) : duration, frame: from };
  };
  const items = [...rows(reply.people).map(row => item(row, '人物', true)), ...rows(reply.clothes).map(row => item(row, '衣服', true)),
    ...rows(reply.things).map(row => item(row, '道具', false))];
  const wanted = typeof reply.replace === 'string' ? reply.replace.split(/[\s,，、;；]+/).filter(Boolean) : Array.isArray(reply.replace) ? reply.replace : [];
  const ids = new Set(items.map(entry => entry.id)), replace = [...new Set(wanted.filter(id => ids.has(id)))];
  const missing = [...new Set(wanted.filter(id => !ids.has(id)))].map(id => `要换的编号 ${id} 在拆解结果里不存在，已忽略`);
  const unsure = unsureList({ unsure: reply.unsure }).unsure;
  const names = rows(reply.things).map(row => String(row.desc ?? '').split(/[，,]/)[0].trim()).filter(Boolean);
  const count = kind => items.filter(entry => entry.kind === kind).length;
  return { summary: `拆解：${count('人物')}个人，${count('衣服')}套衣服${names.length ? `，画面里还有${names.join('、')}` : ''}`,
    items, changes: [], actions: [], replace, unsure: Array.isArray(unsure) ? [...unsure, ...missing] : unsure };
}

const dataUrls = (names, folder) => names.map(name => `data:image/jpeg;base64,${readFileSync(join(folder, name)).toString('base64')}`);
const FRAMES = 6, MAX_IMAGES = 12;

/**
 * 10-26 用户定一轮版：整条大图只问一次，开高档思考、图按最高清晰度看。
 * 10-30 用户定最终提示词由代码拼、拆解只问用得上的：人、每套衣服起止、画面里其他东西的名字外观、要换谁（三条视频实测比旧问法快、省一半，名字时段都对）；
 * 同一次问里附 6 张均分取段中的原片清楚大帧帮它认小东西，名字要结合总览图里怎么动来认（只看大帧会把静止的吊扇叶认成椅子构件）。
 */
export async function analyze(input, { sheets, ask }) {
  const { source, folder, duration, ratio, userText } = input;
  const timeline = await sheets.timeline(input), cuts = await sheets.cuts(source, duration);
  const count = Math.max(0, Math.min(FRAMES, MAX_IMAGES - timeline.length));
  const times = Array.from({ length: count }, (_, i) => Math.round((i + 0.5) * duration / count * 10) / 10);
  const frames = count ? await sheets.frames(input, times) : [];
  const context = { duration, ratio, userText, cuts };
  const pages = timeline.length > 1 ? `共${timeline.length}张，按时间先后排列；` : '';
  const big = frames.length ? `另附${frames.length}张原片清楚大图，依次是${times.join('、')}秒的画面。认东西两种图一起看：叫什么，要结合它在总览大图里怎么动、和什么连在一起来认；清楚大图只拍到某一瞬间，用来看清外观细节和小东西。两种图看着不像同一样东西，或又小又暗看不清是什么，写进unsure，不要猜成别的。` : '';
  const reply = await ask({ round: 'analyze', context, detail: 'xhigh', effort: 'high', images: dataUrls([...timeline, ...frames], folder),
    text: `看总览大图：${pages}整条视频每0.2秒一帧，从左到右、从上到下按时间排列，每行10帧（2秒），每格左上角印有该帧秒数。`
      + '这份结果只用来决定要换哪些人和衣服、给画面里的东西起名字；镜头、场景、动作、东西怎么动都不用写（生成时另有原视频直接参考）。只回答下面四件事：'
      + '①people：画面里的每个人各一项，desc先写通用称呼，逗号后写外观（不写衣服和动作），from、to写出现到消失的秒数。'
      + '②clothes：每个人的每一套衣服各一项，同一时段穿在身上的上衣、裤子、鞋算一套写在一项里；person写是谁的；desc先写通用名称，逗号后写颜色、款式、长短、材质；from、to写穿这套的起止秒数，换装从第一次看到新衣服的那一帧算起。同一套衣服只因动作、遮挡或光线看起来不同，不算换装、不拆成多套。'
      + '③things：人、衣服和场景以外，画面里会动的、被人拿着或用到的、从镜头前经过挡住人的东西各一项；desc先写通用名称（日常叫法），逗号后写外观（颜色、材质、样式），不写位置和动作；背景里不起作用的陈设不列。'
      + '④replace：按用户原话列要换的id，只能用people、clothes、things里的id。'
      + `${big}没把握的写进unsure。只输出JSON对象：{people:[{id:P1起依次编号,desc,from:秒数,to:秒数}],clothes:[{id:C1起依次编号,person:人物id,desc,from:秒数,to:秒数}],things:[{id:D1起依次编号,desc}],replace:[id],unsure:[文字]}。所有秒数必须在视频时长内。`
      + `\n${JSON.stringify(context)}` });
  try { return { plan: validatePlan(uniqueItemIds(planFromReply(reply, duration)), duration), cuts }; }
  catch (error) { throw Error(`${error.message}\n豆包原话：${JSON.stringify(reply)}`); }
}
