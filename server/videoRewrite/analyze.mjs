import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analysisImages } from './analysisImages.mjs';
import { backgroundFrames, checkSceneFrames, SCENES_QUESTION } from './backgroundFrames.mjs';
import { blankLines, LINES_QUESTION, OFF_CAMERA, readLines, validateLines } from './lines.mjs';

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
  validateLines(plan, duration);
  return plan;
}

/** 模型会给不同项起同一个编号（10-25 豆包真测人物、道具都叫 P1）：后出现的改成没人用的「编号_2」，replace 仍指第一个；不动原回话。 */
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

/** 模型会把 unsure 写成一段文字（10-26 晚豆包真测 15 秒整条）：包成一项的数组；空文字、没写、null 当没有；别的样子原样交给校验拒；不动原回话。 */
export function unsureList(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan.unsure)) return plan;
  if (plan.unsure === undefined || plan.unsure === null) return { ...plan, unsure: [] };
  if (typeof plan.unsure === 'string') return { ...plan, unsure: plan.unsure.trim() ? [plan.unsure] : [] };
  return plan;
}

const rows = list => (Array.isArray(list) ? list : []).filter(row => row && typeof row === 'object' && !Array.isArray(row));
const number = value => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value);

/** 11-06：frame 是这套露得最清楚的一帧（截图抽衣服用），写错取这段中间；sameAs 只认前面同一个人的衣服，连环指向归到第一套，写错就当不同的衣服。 */
function outfitItems(list, item) {
  const done = [];
  for (const row of rows(list)) {
    const base = item(row, '衣服', true), frame = number(row.frame), owner = validCardId(row.person) ? { person: row.person } : {};
    const middle = Math.min(base.to, Math.max(base.from, Math.round((base.from + base.to) * 50) / 100));
    const earlier = done.find(entry => entry.id === row.sameAs && entry.person === row.person && row.person !== undefined);
    done.push({ ...base, frame: Number.isFinite(frame) && frame >= base.from && frame <= base.to ? frame : middle, ...owner,
      ...(earlier ? { sameAs: earlier.sameAs ?? earlier.id } : {}) });
  }
  return done;
}

const clampTo = duration => (value, fallback) => { const n = number(value); return Number.isFinite(n) ? Math.min(Math.max(n, 0), duration) : fallback; };
const yes = value => value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true');

/** 11-09：场景整理成段——写坏的丢掉；AI 挑的 frame 落在这段里才用，越界、没写、写成别的取段中；empty 只认 true；按开始秒排（和页面 sceneItems 同序）。 */
export function scenePlaces(list, duration) {
  const clamp = clampTo(duration);
  return rows(list).map(row => {
    const from = clamp(row.from, 0), to = clamp(row.to, duration), frame = number(row.frame);
    const middle = Math.min(to, Math.max(from, Math.round((from + to) * 50) / 100));
    return { id: row.id, kind: '场景', desc: row.desc, from, to, frame: Number.isFinite(frame) && frame >= from && frame <= to ? frame : middle, empty: yes(row.empty) };
  }).filter(row => validCardId(row.id) && text(row.desc) && row.to > row.from).sort((a, b) => a.from - b.from);
}

/**
 * 10-30 窄拆解：模型只回 people / clothes / things / replace，代码转成改写单（页面铺卡、写词照旧用）。
 * 格式毛病能纠正就纠正（钱已花）：秒数写成字符串转数字、越界夹回时长内、没写时段算全片、replace 写成一段字也认、不存在的编号去掉写进 unsure。
 * 11-06：衣服记 person、分屏的人记 where，写词才分得清谁穿哪件；场景至少两个才进单子（写坏的丢掉、不作废）；场景不算要换的项。
 * 11-09：场景的 frame 是挑好的背景帧（scenePlaces），单子里不带 empty。
 */
export function planFromReply(reply, duration) {
  if (!reply || typeof reply !== 'object' || Array.isArray(reply)) return reply;
  const clamp = clampTo(duration);
  const item = (row, kind, timed) => {
    const from = timed ? clamp(row.from, 0) : 0;
    return { id: row.id, kind, desc: row.desc, from, to: timed ? clamp(row.to, duration) : duration, frame: from };
  };
  const place = row => { const where = typeof row.where === 'string' ? row.where.trim() : ''; return where && [...where].length <= 8 ? { where } : {}; };
  const items = [...rows(reply.people).map(row => ({ ...item(row, '人物', true), ...place(row) })),
    ...outfitItems(reply.clothes, item),
    ...rows(reply.things).map(row => item(row, '道具', false))];
  const places = scenePlaces(reply.scenes, duration).map(({ empty: _empty, ...row }) => row);
  const scenes = places.length > 1 ? places : [];
  const wanted = typeof reply.replace === 'string' ? reply.replace.split(/[\s,，、;；]+/).filter(Boolean) : Array.isArray(reply.replace) ? reply.replace : [];
  const ids = new Set(items.map(entry => entry.id)), replace = [...new Set(wanted.filter(id => ids.has(id)))];
  const missing = [...new Set(wanted.filter(id => !ids.has(id)))].map(id => `要换的编号 ${id} 在拆解结果里不存在，已忽略`);
  const unsure = unsureList({ unsure: reply.unsure }).unsure;
  const names = rows(reply.things).map(row => String(row.desc ?? '').split(/[，,]/)[0].trim()).filter(Boolean);
  const count = kind => items.filter(entry => entry.kind === kind).length;
  return { summary: `拆解：${count('人物')}个人，${count('衣服')}套衣服${scenes.length ? `，${scenes.length}个场景` : ''}${names.length ? `，画面里还有${names.join('、')}` : ''}`,
    items: [...items, ...scenes], changes: [], actions: [], replace, unsure: Array.isArray(unsure) ? [...unsure, ...missing] : unsure };
}

/**
 * 10-26 用户定一轮版：整条大图只问一次，开高档思考、图按最高清晰度看。
 * 10-30 用户定最终提示词由代码拼、拆解只问用得上的：人、每套衣服起止、画面里其他东西的名字外观、要换谁（三条视频实测比旧问法快、省一半，名字时段都对）；
 * 同一次问里附 6 张均分取段中的原片清楚大帧帮它认小东西，名字要结合总览图里怎么动来认（只看大帧会把静止的吊扇叶认成椅子构件）。
 * 11-09：多问一项 scenes：按背景分段，每段挑一帧当背景、答有没有人（不再单独附第 0 秒截图）。
 * 11-11 用户定：背景换不换都问——换新背景也要每个场景一张背景卡，挑的那帧给用户当对照（11-06 定的「不跟原片就不问」作废）。
 */
export async function analyze(input, { sheets, ask }) {
  const { duration, ratio, userText } = input;
  const { timeline, cuts, times, frames, images: base } = await analysisImages(input, sheets);
  // 11-19 说话版：再附字幕连拍（每 0.5 秒一帧、比总览图大，看得清字）和量出来的人声时段，多问一项 lines。
  const talk = input.talking ? await talkingImages(input, sheets) : null;
  const images = talk ? [...base, ...talk.images] : base;
  const context = { duration, ratio, userText, cuts, ...(talk ? { talking: true, speech: talk.speech } : {}) };
  const pages = timeline.length > 1 ? `共${timeline.length}张，按时间先后排列；` : '';
  const big = frames.length ? `另附${frames.length}张原片清楚大图，依次是${times.join('、')}秒的画面。认东西两种图一起看：叫什么，要结合它在总览大图里怎么动、和什么连在一起来认；清楚大图只拍到某一瞬间，用来看清外观细节和小东西。两种图看着不像同一样东西，或又小又暗看不清是什么，写进unsure，不要猜成别的。` : '';
  const reply = await ask({ round: 'analyze', context, images,
    text: `看总览大图：${pages}整条视频每0.2秒一帧，从左到右、从上到下按时间排列，每行10帧（2秒），每格左上角印有该帧秒数。`
      + '这份结果只用来决定要换哪些人和衣服、给画面里的东西起名字；镜头、动作、东西怎么动都不用写（生成时另有原视频直接参考）。只回答下面五件事：'
      + '①people：画面里的每个人各一项，desc先写通用称呼，逗号后写外观（不写衣服和动作），from、to写出现到消失的秒数；画面分成上下或左右几块、这个人大部分时间在其中一块时，where写在哪块（上半屏、下半屏、左半屏、右半屏），结尾或中途短暂跨到别的块也照写；否则不写where。'
      + '②clothes：每个人的每一套衣服各一项，同一时段穿在身上的上衣、裤子、鞋算一套写在一项里；person写是谁的；desc先写通用名称，逗号后写颜色、款式、长短、材质；from、to写穿这套的起止秒数，换装从第一次看到新衣服的那一帧算起。同一套衣服只因动作、遮挡或光线看起来不同，不算换装、不拆成多套。frame写这套衣服露得最全最清楚的一帧的秒数（人没被手或东西挡住，不在转场和黑屏里）。隔了一段又穿回款式颜色完全一样的衣服时，sameAs写前面那项的id，否则不写。'
      + '③things：人、衣服和场景以外，画面里会动的、被人拿着或用到的、从镜头前经过挡住人的东西各一项；desc先写通用名称（日常叫法），逗号后写外观（颜色、材质、样式），不写位置和动作；背景里不起作用的陈设不列。'
      + '④replace：按用户原话列要换的id，只能用people、clothes、things里的id。'
      + `${SCENES_QUESTION}${big}${talk ? talk.question : ''}没把握的写进unsure。只输出JSON对象：{people:[{id:P1起依次编号,desc,where,from:秒数,to:秒数}],clothes:[{id:C1起依次编号,person:人物id,desc,from:秒数,to:秒数,frame:秒数,sameAs}],things:[{id:D1起依次编号,desc}],replace:[id],scenes:[{id:S1起依次编号,desc,from:秒数,to:秒数,frame:秒数,empty:true或false}],${talk ? 'lines:[{who:人物id或镜头外,text,from:秒数,to:秒数}],' : ''}unsure:[文字]}。所有秒数必须在视频时长内。`
      + `\n${JSON.stringify(context)}` });
  // 背景帧兜底量亮度只在本机算；量完的场景写回回话，改写单里场景的截图时刻和回给页面的背景帧才一致。
  const places = await checkSceneFrames(scenePlaces(reply?.scenes, duration), duration, second => sheets.peak?.(input, second));
  const checked = reply && typeof reply === 'object' && !Array.isArray(reply) ? { ...reply, scenes: places } : reply;
  try {
    const read = validatePlan(uniqueItemIds(planFromReply(checked, duration)), duration);
    const plan = talk ? validatePlan(withLines(read, reply?.lines, duration, talk.speech), duration) : read;
    return { plan, cuts, backgroundFrames: backgroundFrames(places) };
  } catch (error) { throw Error(`${error.message}\n原话：${JSON.stringify(reply)}`); }
}

/** 字幕连拍：从头到尾每 0.5 秒一帧，每张 4×3 帧、每帧约 360×640（竖屏），图上印秒数。 */
async function talkingImages(input, sheets) {
  const made = await sheets.contact({ source: input.source, folder: input.folder }, { end: input.duration, step: 0.5, columns: 4, rows: 3, area: 360 * 640, prefix: 'subtitle' });
  const speech = await sheets.speech(input, input.duration);
  const images = made.map(({ name }) => `data:image/jpeg;base64,${readFileSync(join(input.folder, name)).toString('base64')}`);
  const ranges = made.map(({ from, to }) => `${from}～${to}秒`).join('、');
  return { images, speech, question: `再附${made.length}张字幕连拍（依次是${ranges}，每0.5秒一帧，每格左上角印有秒数，比总览大图大，用来看清字幕）。${LINES_QUESTION}` };
}

/** 11-19：台词进单子；没读出字幕就按人声时段铺空行，提醒用户自己填。 */
function withLines(plan, list, duration, speech) {
  const people = plan.items.filter(item => item.kind === '人物').map(item => item.id);
  const read = readLines(list, duration, people);
  if (read.lines.length) return { ...plan, lines: read.lines, unsure: [...plan.unsure, ...read.notes] };
  return { ...plan, lines: blankLines(speech, duration, people[0] ?? OFF_CAMERA), unsure: [...plan.unsure, '没认出字幕：按有人声的时段铺了空行，请在台词表里自己填台词'] };
}
