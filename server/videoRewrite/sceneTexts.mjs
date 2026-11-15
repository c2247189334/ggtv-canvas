// 11-13 背景卡「不出图，用文字」（设计 docs/specs/2026-11-12-背景卡用文字-design.md）：用户在背景卡上写大白话，
// 定稿时连同原片那一刻的截图交给本机 agent，由它结合原片写成画面描述。11-12 三条视频 16 段实测 15 段写对，11-13 棒球真出片。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneTextMark } from './writePrompt.mjs';

/** 和 11-12 两批实测同一段说明（第 1～3 条只删了「没写要求的段」那半句，现在空字会被拦），加设计第 5 节的占位、深度里还有的东西、正向写法和 sceneReads。 */
export const SCENE_TEXT_EXTRA = `补充（背景卡改用文字）：这次有几段用户没给背景图，点了「不出图，用文字」，在那一段的背景卡上用大白话写了要求，见「背景卡要求.txt」，每段附原片那一刻的截图。底稿里这几段的「场景是【背景 N 用文字】」只是占位；原片只有一个地方时底稿不写场景，就按背景卡要求.txt 写全片的场景。
对这几段：
1. 先看截图和原片连拍弄清原片这一段场景里有什么、各在哪；再按用户的话写：用户提到的以用户为准，用户没提到的照原片。
2. 写成画面描述：场景是什么样、东西是什么、在人物哪里（脚下 / 身后 / 周围漂浮）、颜色材质；不写「改为 / 换成 / 替换」这类改动口气，不提原片里原来是什么。
3. 同一段里被用户的话换掉的东西，时间轴和其他句子里也不能再出现原来那样东西。
4. 这几段没有背景图，不给它们编 @图片 编号；占位「【… 用文字】」必须全部换成画面描述，一个都不能留。
5. 用户要拿掉的东西如果在动作参考（@视频1）里还有轮廓，在 @视频1 那句末尾补「不采用其中的××」，同时列进 unfixable，提醒可能压不住。
6. 拿掉东西也用正向写法写画面里是什么（例如「天花板平整干净」），不写「没有××」。
在 changes 里逐段写清你是怎么理解用户那句话的；输出的 JSON 另加 "sceneReads":[{"title":"背景卡名","read":"一句话：你把用户那句话理解成什么、这一段最后写成什么样"}]，每张背景卡一条。`;

/** 卡名是用户随手写的，要当文件名用：路径符号、盘符冒号、Windows 不认的字符、开头的点都换成下划线，免得写到临时目录外面。 */
const fileSafe = title => title.replace(/\s+/g, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '_');

/** 每张卡管哪几秒、截原片哪一秒：拆解单这个场景的 frame（背景帧），全片一个地方或没有 frame 取 0 秒；截图文件名。 */
export function sceneTextRows(sceneTexts, plan, seconds) {
  return sceneTexts.map(row => {
    const scene = (plan?.items ?? []).find(item => item.kind === '场景' && item.id === row.sceneId);
    const frame = Number.isFinite(scene?.frame) ? scene.frame : 0;
    const second = Math.round(Math.max(0, Math.min(frame, seconds - 0.15)) * 10) / 10;
    return { ...row, scene, second, file: `${fileSafe(row.title)}_原片${second.toFixed(1)}s.jpg` };
  });
}

export function sceneTextNote(rows) {
  return rows.map(row => `${row.title}（${row.scene ? `管 ${row.scene.from}-${row.scene.to} 秒，拆解单场景 ${row.scene.id}` : '管全片'}）：`
    + `用户写「${row.text}」。这一段原片截图：${row.file}`).join('\n');
}

/** 小服务自己从原片截，不靠画布上的「原片」截图卡（用户删了、剪了线都不影响）。 */
export async function sceneTextFiles(rows, sourcePath, folder, sheets) {
  const files = [];
  for (const [index, row] of rows.entries()) {
    const dir = join(folder, `scene-text-${index}`);
    mkdirSync(dir, { recursive: true });
    const [name] = await sheets.frames({ source: sourcePath, folder: dir }, [row.second], { maxSide: 720 });
    files.push({ name: row.file, buffer: readFileSync(join(dir, name)) });
  }
  return [...files, { name: '背景卡要求.txt', buffer: Buffer.from(sceneTextNote(rows)) }];
}

/** 每张卡一条回显；agent 漏写的照样列出来，写明没说怎么理解（不拦）。 */
export function sceneReadsOf(sceneTexts, reads = []) {
  return sceneTexts.map(({ title, text }) => ({ title, text,
    read: reads.find(row => row.title.replace(/\s+/g, '') === title.replace(/\s+/g, ''))?.read || '（没说怎么理解）' }));
}

/** 假模式只为点通页面：占位直接换成原话，不让 agent 理解。 */
export function fakeSceneTexts(prompt, sceneTexts) {
  return sceneTexts.reduce((text, row) => text.split(sceneTextMark(row.title)).join(`（用户写：${row.text}）`), prompt);
}
export const FAKE_SCENE_READ = '假模式：原话直接写进提示词，没让 AI 理解。';
