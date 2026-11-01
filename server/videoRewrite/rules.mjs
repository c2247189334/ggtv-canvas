import { MAX_PROMPT } from '../jobInput.mjs';
import { MESH_PURPOSE } from '../mesh/purpose.mjs';

export const EDIT_WORDS = ['编辑视频', '增加', '加上', '删除', '去掉', '修改', '替换', '改成'];
export const targetDuration = duration => Math.round(duration);

/** 输入清理和输出检查共用原句及逗号、顿号、分号切出的至少六字片段。 */
export function originalDescriptionParts(desc) {
  if (typeof desc !== 'string' || !desc.trim()) return [];
  return [...new Set([desc.trim(), ...desc.split(/[，,、；;]/).map(part => part.trim()).filter(part => [...part].length >= 6)])];
}
export function originalDescriptionMatch(text, desc) {
  return originalDescriptionParts(desc).find(part => text.includes(part));
}

/**
 * 换装点：除最早一套外每套衣服开始处（start）。10-29：动作、道具、遮挡物的变化不单独占一秒段，交给深度视频（10-26 真跑把扇叶写进了 1-2 秒动作段）。
 * 衣服起止常比换装晚一点（10-29 真跑衣服2写 6 秒开始、换装写 5.8）：上一套结束前 0.3 秒到这一套开始之间有 changes，就用离开始最近的那个当秒数（second）。
 */
export function outfitChangePoints(plan) {
  const clothes = (plan?.items ?? []).filter(item => item?.kind === '衣服' && Number.isFinite(item.from) && Number.isFinite(item.to));
  const first = Math.min(...clothes.map(item => item.from));
  const marks = (plan?.changes ?? []).map(change => change?.second).filter(Number.isFinite);
  const starts = [...new Set(clothes.map(item => item.from).filter(start => start > first))].sort((a, b) => a - b);
  const points = starts.map(start => {
    const low = Math.min(start, Math.max(...clothes.filter(item => item.from < start).map(item => item.to))) - 0.3;
    return { second: marks.filter(mark => mark >= low && mark <= start).sort((a, b) => b - a)[0] ?? start, start };
  });
  return points.filter((point, index) => points.findIndex(other => other.second === point.second) === index);
}
export const outfitChangeSeconds = plan => outfitChangePoints(plan).map(point => point.second).sort((a, b) => a - b);

/** 区间统一写成“0-6秒”；源视频小数时长四舍五入为生成时长（源已限 4~30 秒，结果仍在 2.5 的 4~30 秒内）。 */
export function checkRules({ videoPrompt, materials = [], duration, changeSeconds, plan }) {
  const text = typeof videoPrompt === 'string' ? videoPrompt : '';
  const issues = [];
  if (!text.trim()) issues.push('请填写视频提示词。');
  if (text.length > MAX_PROMPT) issues.push(`提示词太长，最多 ${MAX_PROMPT} 字。`);
  for (const word of EDIT_WORDS) if (text.includes(word)) issues.push(`提示词含有「${word}」，请用画面和动作直接描述。`);
  // 仅排除完整括号内的穿着时段；正文“0-5秒穿…”仍是时间轴。
  const matches = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(?:秒)?\s*[-—–~～至到]\s*(\d+(?:\.\d+)?)\s*秒/g)]
    .filter(match => !(/[（(]\s*$/.test(text.slice(0, match.index)) && /^\s*穿[）)]/.test(text.slice(match.index + match[0].length))));
  const intervals = matches
    .map(match => [Number(match[1]), Number(match[2])]);
  if (!intervals.length) issues.push('请写出从0到结尾的时间轴，例如「0-6秒」。');
  if (intervals.some(pair => pair.some(n => !Number.isInteger(n)))) issues.push('时间轴区间必须使用整数秒。');
  if (intervals.length && intervals[0][0] !== 0) issues.push('时间轴必须从0秒开始。');
  if (intervals.some(([from, to]) => to <= from)) issues.push('时间轴每段的结束秒数必须大于开始秒数。');
  if (intervals.some(([from], i) => i > 0 && from !== intervals[i - 1][1])) issues.push('时间轴各段必须首尾相接，不能断开或重叠。');
  if (intervals.length && intervals.at(-1)[1] !== targetDuration(duration)) issues.push(`时间轴最后一段必须到${targetDuration(duration)}秒（源时长四舍五入）。`);
  for (const second of changeSeconds ?? outfitChangeSeconds(plan)) {
    const from = Math.floor(second);
    if (from + 1 > targetDuration(duration)) continue;
    if (!intervals.some(([start, end]) => start === from && end === from + 1)) {
      issues.push(`变化点${second}秒必须单独写成「${from}-${from + 1}秒」的一秒区间，并描述变化。`);
    }
  }
  const subtitleOk = clause => /不要字幕$/.test(clause) && clause.split('字幕').length === 2;
  if (text.split(/[。；;，,\n！？!?]/).some(clause => clause.includes('字幕') && !subtitleOk(clause.trim().replace(/[“”「」"']/g, '')))) {
    issues.push('提到字幕时只许写「不要字幕」，请删除其他字幕说法。');
  }
  const known = new Set(materials.map(item => item.tag));
  const mentions = [...text.matchAll(/@(?:图片|视频|音频)\d+/g)];
  const mentioned = new Set(mentions.map(match => match[0]));
  const originals = [...materials.map(material => ({ label: material.tag, desc: material.originalDesc })),
    ...(plan?.items ?? []).filter(item => plan.replace?.includes(item.id)).map(item => ({
      label: materials.find(material => material.itemId === item.id)?.tag ?? `${item.kind} ${item.id}`, desc: item.desc
    }))];
  for (const { label, desc } of originals) {
    const fragment = originalDescriptionMatch(text, desc);
    const issue = `${label}还写着原视频的原描述「${fragment}」，请删掉这段，只用素材编号指代你上传的素材。`;
    if (fragment && !issues.includes(issue)) issues.push(issue);
  }
  for (const material of materials) {
    const first = mentions.find(match => match[0] === material.tag);
    if (matches.length && (!first || first.index >= matches[0].index)) {
      issues.push(`${material.tag}的素材职责要放在时间轴前，请在第一个时间区间前写明它采用什么、不采用什么。`);
    }
  }
  for (const tag of known) if (!mentioned.has(tag)) issues.push(`提示词没有提到素材 ${tag}，请补上编号和用途。`);
  for (const tag of mentioned) if (!known.has(tag)) issues.push(`提示词里的 ${tag} 不存在，请检查素材连线。`);
  const sentences = text.split(/[。；;\n]/);
  for (const { tag, purpose } of materials) if (tag.startsWith('@视频') && (purpose.includes('深度') || purpose === MESH_PURPOSE)) {
    const used = sentences.some(sentence => [...sentence.matchAll(/@(?:图片|视频|音频)\d+/g)].some(match => match[0] === tag)
      && sentence.includes('机位') && sentence.includes('动作'));
    if (!used) issues.push(`${tag}是${purpose === MESH_PURPOSE ? '白模参考' : '深度视频'}，必须在同一句写明参考「机位」和「动作」。`);
  }
  for (const { tag, purpose } of materials) if (purpose.startsWith('背景')) {
    const used = sentences.some(sentence => [...sentence.matchAll(/@(?:图片|视频|音频)\d+/g)].some(match => match[0] === tag) && sentence.includes('场景'));
    if (!used) issues.push(`${tag}是背景图，必须在同一句写明它是「场景」。`);
  }
  for (const tag of known) if (tag.startsWith('@音频') && mentioned.has(tag)) {
    const used = sentences.some(sentence => sentence.includes(tag) && /背景音乐|节奏|音色|配音|旁白|人声|音效|用作|用于/.test(sentence));
    if (!used) issues.push(`${tag} 还没写用途，请说明它是背景音乐、音色还是音效。`);
  }
  return issues;
}
