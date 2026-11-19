// 11-19「露脸 · AI 自己配音」（设计 docs/specs/2026-11-19-口播改写-design.md 第 4、6 节）：拆解多读台词、台词表校验、提示词里台词核对。
export const OFF_CAMERA = '镜头外';
export const MAX_LINES = 200, MAX_LINE_TEXT = 200;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const round = n => Math.round(n * 10) / 10;
/** 片长往下取到 0.1 秒：秒数最多到这儿。先夹再四舍五入会把 8.47 秒的片尾进成 8.5、超出片长（11-19 上传前审查）。页面 rewriteLines.ts 同一份。 */
export const lastTenth = duration => Math.floor(duration * 10) / 10;
const number = value => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value);
const rows = list => (Array.isArray(list) ? list : []).filter(row => row && typeof row === 'object' && !Array.isArray(row));

/** 拆解提问多出的一项（字幕连拍和有人声的时段由调用方附上）。 */
export const LINES_QUESTION = '⑥lines：原片里说出来的每一句话各一项，按时间先后。text照字幕原字抄，不改字、不补字，标点可以省；'
  + `who写说话的人：画面里的人在开口说就写他的people id；字幕出现时画面里的人闭着嘴、或明显是画面外的人在说，写"${OFF_CAMERA}"；拿不准是谁说的写进unsure。`
  + 'from、to写这句话的起止秒数：字幕出现到消失，再对照context里speech（有人声的时段）对齐。画面里没有字幕就输出空数组lines:[]，不要凭口型猜字。';

/**
 * 读台词回话（钱已花，能纠正就纠正）：字去掉大括号和首尾空白，没字的丢掉；秒数写成字符串转数字、越界夹回；结束不晚于开始就补到开始后 1 秒；
 * 谁说认不出：只有一个人就算他，否则算镜头外，各记一条没把握。按开始秒排，编号 L1 起。
 */
export function readLines(list, duration, peopleIds) {
  const notes = [], top = lastTenth(duration), latestStart = Math.max(0, round(top - 0.1));
  const sec = value => { const n = number(value); return Number.isFinite(n) ? Math.min(Math.max(round(n), 0), top) : null; };
  const lines = rows(list).map(row => {
    // 字幕两行显示时 AI 会带回换行：并成一个空格，否则写进 {} 后跨行，一字不差检查认不出来。
    const text = typeof row.text === 'string' ? row.text.replace(/[{}]/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, MAX_LINE_TEXT) : '';
    const from = Math.min(sec(row.from) ?? 0, latestStart);
    let to = sec(row.to) ?? Math.min(top, round(from + 1));
    if (to <= from) to = Math.min(top, round(from + 1));
    const said = typeof row.who === 'string' ? row.who.trim() : '';
    let who = said === OFF_CAMERA || peopleIds.includes(said) ? said : '';
    if (!who && text) {
      who = peopleIds.length === 1 ? peopleIds[0] : OFF_CAMERA;
      notes.push(`「${text.slice(0, 12)}」是谁说的没认准，先算${who === OFF_CAMERA ? OFF_CAMERA : '出镜的人'}，请在台词表里核一眼`);
    }
    return { who, text, from, to };
  }).filter(line => line.text && line.to > line.from).sort((a, b) => a.from - b.from).slice(0, MAX_LINES);
  return { lines: lines.map((line, index) => ({ id: `L${index + 1}`, ...line })), notes };
}

/** 没认出字幕：按有人声的时段铺空行（字空着等用户填）；一段人声也没量出来就铺一行管全片。 */
export function blankLines(speech, duration, who) {
  const top = lastTenth(duration), latestStart = Math.max(0, round(top - 0.1));
  const spans = (speech ?? []).filter(([from, to]) => to > from).slice(0, 60);
  return (spans.length ? spans : [[0, duration]])
    .map(([from, to]) => ({ from: Math.min(round(from), latestStart), to: Math.min(round(to), top) }))
    .filter(span => span.to > span.from)
    .map((span, index) => ({ id: `L${index + 1}`, who, text: '', ...span }));
}

/** 改写单里的 lines（可以没有）：编号不重复、谁说是人物项或镜头外、秒数在时长内；allowBlank 为假时每句都要有字。 */
export function validateLines(plan, duration, { allowBlank = true } = {}) {
  if (plan.lines === undefined) return;
  const fail = message => { throw Error(`台词表不对：${message}`); };
  if (!Array.isArray(plan.lines) || plan.lines.length > MAX_LINES) fail(`最多 ${MAX_LINES} 句。`);
  const people = new Set((plan.items ?? []).filter(item => item.kind === '人物').map(item => item.id)), ids = new Set();
  for (const line of plan.lines) {
    if (!line || !ID.test(line.id) || ids.has(line.id)) fail('编号重复或不对，请重新做一次视频改写。');
    ids.add(line.id);
    if (line.who !== OFF_CAMERA && !people.has(line.who)) fail('有一句没写是谁说的。');
    if (typeof line.text !== 'string' || line.text.length > MAX_LINE_TEXT || /[{}]/.test(line.text)) fail(`每句最多 ${MAX_LINE_TEXT} 字，不能带大括号。`);
    if (!allowBlank && !line.text.trim()) fail('还有没填字的句子，填好或删掉再生成提示词。');
    if (![line.from, line.to].every(n => Number.isFinite(n) && n >= 0 && n <= duration) || line.to <= line.from) fail('有一句的秒数不在视频时长里，或结束不晚于开始。');
  }
}

/** 页面检查接口带来的台词：只认 [{ text }]。 */
export function checkLineTexts(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_LINES || value.some(row => typeof row?.text !== 'string' || row.text.length > MAX_LINE_TEXT)) {
    throw Error('台词表格式不对；这次没检查。');
  }
  return value.map(row => ({ text: row.text }));
}

/** 提示词里 {} 里是人说的话，不是指令：别的检查（编辑词、字幕）先把它们换成占位再查。 */
export const withoutLines = text => text.replace(/\{[^{}\n]*\}/g, '{台词}');

const plain = text => String(text).replace(/[\s，,。.！!？?、；;：:“”"'‘’…~～—\-·]/g, '');
/** 台词表里每一句都要在 {} 里原样出现一次、先后不变（标点、空格不算）；提示词里不许有台词表外的 {}。 */
export function lineIssues(text, lines) {
  const want = lines.map(line => line.text).filter(value => value.trim());
  const found = [...text.matchAll(/\{([^{}\n]*)\}/g)].map(match => match[1]);
  const issues = [];
  for (const line of want) if (!found.some(value => plain(value) === plain(line))) issues.push(`台词「${line}」没原样写进提示词：要放进 {} 里，一字不差。`);
  for (const value of found) if (!want.some(line => plain(line) === plain(value))) issues.push(`提示词里的 {${value}} 不在台词表里：{} 里只写台词表里的句子。`);
  if (!issues.length && found.length !== want.length) issues.push('有台词写了两遍：台词表里每句在提示词里只写一次。');
  if (!issues.length && found.some((value, index) => plain(value) !== plain(want[index]))) issues.push('台词的先后要和台词表一样。');
  return issues;
}
