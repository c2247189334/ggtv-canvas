// 11-19「露脸 · AI 自己配音」写提示词（设计 docs/specs/2026-11-19-口播改写-design.md 第 6 节）：照 11-17 真出片过关那条的写法，
// 开头一句声音约束、时间轴每段末尾放 {台词}、结尾嗓音句 + 嘴型同步 + 不要音乐。程序底稿只排好台词，每段在做什么交给定稿看原片写。
import { OFF_CAMERA } from './lines.mjs';

export const SOUND_RULE = '声音约束：音频只保留说话人声和轻微的现场环境声，不产出任何音乐类音轨，不要音乐、背景音乐、BGM、配乐、器乐、旋律、氛围铺底音。';
/** 用户没写嗓音时底稿用这句，定稿时本机 AI 助手照人物图改成具体的一句（TALKING_EXTRA）。 */
export const DEFAULT_VOICE = '和人物的长相、年纪相符的自然嗓音，普通话，吐字清楚，语气自然';

/**
 * 把底稿时间轴（[{ from, to, body, fixed }]，fixed 是换装 / 换场那一秒，不能拆）按台词再切：在台词开始的整秒处切开，每段至少 2 秒、最后一段至少 1 秒；
 * 每句台词放进它开始（取整）的那一段末尾。切出来的后几段不重复前一段的穿着描述（定稿看原片补每段在做什么）。
 */
export function talkingSegments(parts, lines, nameOf) {
  const keyOf = line => Math.round(line.from);
  const pieces = parts.flatMap(part => {
    if (part.fixed) return [part];
    const cuts = [...new Set(lines.map(keyOf))].filter(at => at > part.from && at < part.to).sort((a, b) => a - b);
    const kept = [];
    let last = part.from;
    for (const at of cuts) if (at - last >= 2 && part.to - at >= 1) { kept.push(at); last = at; }
    const edges = [part.from, ...kept, part.to];
    return edges.slice(0, -1).map((from, index) => ({ from, to: edges[index + 1], body: index ? '' : part.body, fixed: false }));
  });
  const owner = line => pieces.find(piece => keyOf(line) >= piece.from && keyOf(line) < piece.to) ?? pieces.at(-1);
  return pieces.map(piece => {
    const said = lines.filter(line => owner(line) === piece);
    const speech = said.map(line => line.who === OFF_CAMERA ? `镜头外不出镜的人说：{${line.text}}` : `${nameOf(line.who)}对镜头说：{${line.text}}`);
    const listening = said.length && said.every(line => line.who === OFF_CAMERA) && nameOf(null) ? [`${nameOf(null)}闭着嘴听`] : [];
    return { ...piece, body: [piece.body, ...listening, ...speech].filter(Boolean).join('，') };
  });
}

/** 结尾：嗓音句 + 嘴型同步 + 声音约束（再说一遍，11-17 过关那条两处都写了），后面接原来的结尾（不要字幕）。 */
export function talkingClosing(lines, nameOf, voice) {
  const speakers = [...new Set(lines.filter(line => line.who !== OFF_CAMERA).map(line => nameOf(line.who)))];
  const who = speakers.length === 1 ? speakers[0] : '出镜的人';
  const offCamera = lines.some(line => line.who === OFF_CAMERA);
  return [`${who}说话的声音是${voice || DEFAULT_VOICE}。`, `${who}说每一句台词时嘴型和声音同步，吐字清晰，台词一字不差。`,
    ...(offCamera ? ['镜头外的人说话时，画面里的人闭着嘴听。'] : []),
    '音频只保留说话人声和轻微的现场环境声，不要音乐、背景音乐、BGM、配乐、旋律。'].join('');
}

/** 11-19 第二期：人物带的声音样本，页面给的用途以这个开头（`src/domain/voiceCard.ts` 同一个字）。 */
export const VOICE_PURPOSE = '音色';
/** 照 2.5 提示词指南第 188 行「图片 1 使用音频 1 音色」；只要音色，不要样本里说的话和背景声（参考音频也会带对话内容，2.0 教程第 173 行）。 */
export function voiceRole(tag, who) {
  return `${tag}是${who}的声音样本：${who}使用${tag}的音色说话；只采用${tag}的音色，不采用其中说的话和背景声。`;
}

/** 台词开始得比视频时长还晚（用户把时长改短了）：提醒，不拦。 */
export function lateLineNotes(lines, total) {
  const late = lines.filter(line => line.from >= total);
  return late.length ? [`有 ${late.length} 句台词在第 ${total} 秒以后才开始，超出了视频时长，都挤在最后一段；要么把时长改长，要么在台词表里删掉。`] : [];
}

/** 定稿时多给本机 AI 助手的一节说明（finalPrompt 的系统提示）。 */
export const TALKING_EXTRA = `说话版（这条视频里的人要开口说话；生成音频开着，声音由 Seedance 自己生成；台词表.txt 是要说的每一句）：
- 底稿时间轴里 {} 里的字就是台词：每一句都原样留在 {} 里，一字不差、先后不变、每句只写一次；不许改字、不许把台词挪出 {}，也不许写台词表里没有的 {}。秒数划分照底稿。
- 每段先写这段画面里的人在做什么（看原片连拍），再写谁说话：出镜的人写「对镜头说：{…}」；镜头外的人说话时写「镜头外不出镜的人说：{…}」，同一段写画面里的人闭着嘴听。原片连拍里看出某句其实是另一个人在开口，只在台词表.txt 列出的人里换说话人，不动台词的字。
- 嗓音：台词表.txt 写了「嗓音（用户写的）」，结尾嗓音句就原样用它；写的是「嗓音：用户没写」，就照人物图把结尾「说话的声音是…」那句改成具体的一句：性别、年纪感、音色、语速、语气，普通话。
- 开头的「声音约束」和结尾「嘴型和声音同步，吐字清晰，台词一字不差」「音频只保留说话人声…不要音乐」保留。
- 素材里有声音样本（「@音频N是…的声音样本：…使用@音频N的音色说话」）时，那句原样保留，不要改成背景音乐、节奏参考；结尾嗓音句照台词表.txt，和声音样本一起用。`;

/** 交给定稿的台词表文件：每句的秒数、谁说（素材编号或镜头外）、字；最后一行写嗓音是用户写的还是没写。 */
export function linesFile(lines, nameOf, voice) {
  const rows = lines.map((line, index) => `${index + 1}. ${line.from}-${line.to}秒 ${line.who === OFF_CAMERA ? OFF_CAMERA : nameOf(line.who)}：${line.text}`);
  return [...rows, voice ? `嗓音（用户写的，原样用）：${voice}` : '嗓音：用户没写，请照人物图写一句。'].join('\n');
}
