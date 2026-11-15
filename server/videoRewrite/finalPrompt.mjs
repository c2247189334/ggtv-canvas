// 11-08 用户定：「帮我改写 / 生成提示词 / 让 Claude 看一遍」合成一个「生成提示词」——程序按模板拼底稿，本机 agent 对照参考图、
// 原片和动作参考同一时刻的抽帧只改会出错的句子，再过程序规则检查；过不了带着问题再改一次，还过不了就退回底稿。人物改写、拆解（无人物）共用。
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentHealth } from '../agent.mjs';
import { parseModelJson } from './modelJson.mjs';
import { planChangeSeconds } from './rules.mjs';
import { FAKE_SCENE_READ, fakeSceneTexts, SCENE_TEXT_EXTRA, sceneReadsOf, sceneTextFiles, sceneTextRows } from './sceneTexts.mjs';
import { removeRewrite, rewriteFolder } from './storage.mjs';

// 11-10 用户定：每次生成提示词都按官方 Seedance 2.5 提示词指南写（暂时不管选的哪个模型），再结合这次的视频。
const COMMON = `你是 Seedance 2.5「视频复刻」的提示词定稿员。底稿.txt 是程序按固定模板拼好的提示词，素材分工、秒数划分和换装时间已按真出片调过。你的任务：按官方 Seedance 2.5 提示词指南（见下面「官方写法」）把底稿补齐成官方结构，再对照参考图、原片抽帧、拆解单改掉会让成片出错的句子；程序写好的素材分工句和秒数划分保留，其余没问题的句子不改。输出可以直接发给 Seedance 的定稿。不评价文笔，不为了好看改写。

先用 Read 看完当前目录全部文件：底稿.txt、素材表.txt（每个编号是什么、对应哪个文件、抽帧文件名）、拆解单.json（第一次看原片拆出来的结果：人物 / 衣服 / 场景 / 商品 / 东西、各自时段和拆解没把握的地方；它可能有错，以原片抽帧为准）、用户原话.txt、提醒.txt（如有）、全部图片。

每一处修改都要有证据（哪张图、第几秒、看到什么）；看不清就说看不清，不凭常识补。`;

const PERSON = `核对清单（人物改写：把原片里的人 / 衣服 / 场景换成参考图）：
1. 人物对应：每个要换的人在原片哪里、什么时候出现；底稿里「谁就是 @图片N」在全片是不是都成立。某段时间对应关系变了（两个人进了同一块画面、交换位置、多出一个人），在那一段时间轴里加一句，写清这段每个位置的人分别是哪张图——只写是谁，不写动作。
2. 人物句：一张人物图里有多个身影时，写「这些身影是同一个人的不同角度，只算一个人」；不能让整个画面只出现一个人（视频里有几个人就是几个人）。
3. 衣服图：逐张看衣服图里除了衣服还有什么。帽子、头冠、头纱、鞋、袜子、手套、首饰这些穿戴的东西照图穿戴（衣服图是用户挑好的样子，原片同时段没有也照图），在用这张图的那几段穿着里写出来；衣服图里的假发不采用（发型以人物图为准），除非用户原话要保留原片发型；衣服图里拿在手上或摆在旁边、不是穿戴的东西不采用，除非原片同时段手里也拿着同样的东西。
4. 场景：背景图和原片同一段是不是同一个地方（包括上下 / 左右分屏的结构）。
5. 东西：写不写以原片抽帧和拆解单为准（动作参考帧只管动作，东西在里面糊成一块、看不出是什么是正常的，不能当不写的理由）。拆解单里的东西，若在原片里被人拿着或占画面很大一块、背景图里又没有，就在它出现的那段时间轴里加一句它是什么（名字和外观），被人拿着的写明在谁手里；不写它摆在哪、朝哪个方向。原片抽帧里也看不清是什么的不写。
6. 动作参考是深度视频或白模：它不像原片那么准（看不出东西和颜色，胳膊贴在身前会和身体糊成一块）。官方 2.5 白模那节要求在提示词里写清希望生成的内容、并和动作参考吻合，四肢在动的要补全动作序列，否则容易僵。所以每一段都写这段画面里是什么：谁、穿什么、手里拿着什么、在做什么。「在做什么」看原片连拍（每 0.5 秒一帧）：照官方用概括说法写，只写连拍里连续两帧以上看得清的动作；有记忆点的快动作（踢腿、转圈、把东西抛起再接住）连拍里看清了就点名写一句，看不全的写「动作跟随 @视频1」；连拍里没看到的动作不写，不凭一两张帧猜姿势。胳膊、手贴在身前做的事（举东西到嘴边、两手在身前摆弄东西）在动作参考里看不出，要补全这个动作。动作的先后、快慢和走位仍以 @视频1 为准，不和它矛盾。
   转场：换装 / 换场点前后另有每 0.2 秒一帧的连拍，转场方式照它写。
7. 动作参考帧里有大块头发（辫子、马尾、长发）或裙摆轮廓、而人物图不是这样：改字压不住，只列进 unfixable，建议换白模。
8. 图本身画错、要重抽图或换素材的，列进 unfixable，不要硬改。`;

const PRODUCT = `核对清单（拆解无人物：原片动作、手脚、运镜照 @视频1，只把原片里的商品换成商品实物照）：
1. 商品外观只照商品实物照：逐张看实物照，外观句的颜色、材质、结构要和照片一致；不写原片那款商品的品牌、字母标、颜色、结构（拆解单 look / now 是原片的样子，只用来认是哪一样，不能写进提示词）。
2. 数量和摆位：按原片抽帧核对几双几只、放在哪、谁拿着；和抽帧明显不符就改，看不清不改。
3. 时间轴：每段写的动作和画面要在原片抽帧里看得到；写了原片没有的东西（凭空多出包、手表、道具）或和好几张帧明显相反的动作就改成原片里的样子或删掉那半句；抽帧之间看不到的小出入不改。
4. 场景和穿搭：有背景图时场景照背景图；换了颜色的场景、穿搭要前后一致，不能和商品外观或别的句子颜色打架。
5. 不要求露脸；原片有脸的画面只列进 unfixable 提醒可能被审核拦。
6. 商品照本身拍错（不是同一件、缺角度），列进 unfixable，不要硬改。`;

const RULES = `官方写法（Seedance 2.5 提示词指南，必须照做；不管这次选的是哪个模型，一律按 2.5 写）：
- 结构按顺序四块：①素材指代：每个素材先写编号和用途，只参考一部分时写明参考哪一部分，多个人 / 多个商品逐一写清对应关系（底稿已写好，保留）；②一句话概述：素材句之后、第一个时间区间之前，用一句话写清主体 + 地点 + 事件（+ 风格或特殊运镜），照原片抽帧和用户原话写；③时间轴：整数秒，从 0 开始、首尾相接、最后一段到 {DURATION} 秒，逐段写这段画面里是什么，尽量正向描述，不用时间戳控制次数；④结尾：只写贯穿全片不变的东西（人、光线、机位风格等）和「不要字幕」，各段会变的东西（衣服、道具、布景、陪衬）不许写成全程不变或「同一个场景」。
- 参考素材本身已经足够准的部分只指代、不复述（如原片本身当参考时的动作和运镜）；不够准的部分按核对清单写清。
- 转场：写清在哪一秒、怎么转（官方例子「第 5s 快速向左横移转场」；常见的有甩镜头、硬切、闪白、东西飞向镜头后切），方式照原片抽帧；看不清就写「方式和时机跟随 @视频1」，不猜。
- 动作用概括说法（官方例子「连续做了几组高抬腿和空翻」），只把少数有记忆点的动作写细（官方例子「右手使劲一挥将手里的飞机放飞」）；不重复写同一个动作，不写次数。
- 负向说法只用于字幕（只许写「不要字幕」）和声音；其余一律正向写，例如要衣服干净就写「纯色面料，表面干净」，不写「无字母、无商标、无图案、不出现…」；「采用… / 不采用…」的素材分工写法不算负向。
- 前后不能矛盾：同一样东西各处说法一致；文字要和动作参考里的内容吻合（人数、衣服长短、东西在不在画面里）。

其他必须遵守（程序会再检查一遍，过不了会把问题发回给你）：
- 不许出现：编辑视频、增加、加上、删除、去掉、修改、替换、改成（会被当成编辑任务）；也不写 slowly、缓慢、轻轻、慢慢这类放慢节奏的词。
- 每个素材编号的分工句都在第一个时间区间之前；素材表里的每个编号都要提到；不许出现素材表里没有的编号；不许把 @图片N 写成 @图像N 或别的写法（底稿怎么写就怎么写）。
- 底稿里关于 @视频1 那句的关键词（机位、动作、运镜等）、背景图那句的「场景」两个字都要保留；底稿里单独占一秒的区间（换装、换场景那一秒）保持原来的秒数划分。
- 不许照抄拆解单里原视频人物、衣服、商品、场景的原描述（desc / look / now 原文或其中连续六个字以上），只用素材编号指代。
- 全文不超过 4000 字。底稿已经符合以上全部要求、没发现要改的，才原样输出底稿，changes 给空数组。

输出：只输出一个 JSON 对象，不要别的文字、不要代码围栏：
{"prompt":"定稿全文（保留底稿的换行）","changes":[{"before":"底稿原句","after":"改后的句子","why":"为什么改","evidence":"哪张图、第几秒、看到什么"}],"unfixable":[{"what":"改字解决不了的问题","evidence":"证据","fix":"建议用户怎么处理"}],"checked":"一句话说明看了哪些文件"}`;

export function finalSystem(kind, duration, sceneText = false) {
  return [COMMON, kind === 'product' ? PRODUCT : PERSON, RULES.replace('{DURATION}', String(duration)), ...(sceneText ? [SCENE_TEXT_EXTRA] : [])].join('\n\n');
}

/** 抽帧时刻：6～10 个，从 0 均分到结尾（留 0.15 秒免得读到黑尾）。 */
export function frameTimes(duration) {
  const n = Math.min(10, Math.max(6, Math.round(duration * 0.7)));
  return Array.from({ length: n }, (_, i) => Math.round(Math.max(0, Math.min(duration - 0.15, i * duration / (n - 1))) * 10) / 10);
}

export function modelLabel(model) {
  const id = String(model ?? '');
  return /2-5/.test(id) ? 'Seedance 2.5' : /2-0-mini/.test(id) ? 'Seedance 2.0 Mini' : /2-0/.test(id) ? 'Seedance 2.0 Pro' : id.slice(0, 40);
}

/** 页面只发素材引用：图片经 promptImages 缩到 1024 读成文件，视频经 media 找到路径，原片另给路径对照。 */
export async function resolveFinalMaterials(materials, source, { promptImages, media }) {
  const pictures = materials.filter(material => material.tag.startsWith('@图片') && material.asset);
  const images = pictures.length ? await promptImages.prepare(pictures) : [];
  const clip = source ? media.checkSource(source) : null;
  const safe = text => String(text ?? '').replace(/[\\/:*?"<>|（）()\s]/g, '').slice(0, 8);
  return materials.map(material => {
    if (material.tag.startsWith('@图片')) {
      const index = pictures.indexOf(material);
      if (index < 0) return material;
      return { ...material, image: { name: `${material.tag.slice(1)}_${safe(material.purpose)}.jpg`, buffer: Buffer.from(String(images[index]).split(',')[1] ?? '', 'base64') } };
    }
    if (material.tag.startsWith('@视频') && material.asset) {
      const meta = media.checkSource(material.asset);
      const sameAsSource = clip && meta.path === clip.path;
      return { ...material, video: { path: meta.path, seconds: meta.duration, source: clip && !sameAsSource ? { path: clip.path, seconds: clip.duration } : null } };
    }
    return material;
  });
}

/** 回话必须有 prompt；changes / unfixable 每项只留短文字。 */
export function parseFinal(text) {
  let body;
  try { body = parseModelJson(String(text ?? '')); } catch { throw Error(`定稿结果不是 JSON：${String(text ?? '').slice(0, 200)}`); }
  if (typeof body?.prompt !== 'string' || !body.prompt.trim()) throw Error(`定稿结果没有 prompt：${String(text).slice(0, 200)}`);
  const field = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const list = (rows, keys) => (Array.isArray(rows) ? rows : []).map(row => Object.fromEntries(keys.map(key => [key, field(row?.[key])])));
  const sceneReads = list(body.sceneReads, ['title', 'read']).filter(row => row.title && row.read);
  return { prompt: body.prompt.replace(/\r\n/g, '\n').trim(), changes: list(body.changes, ['before', 'after', 'why', 'evidence']).filter(row => row.after || row.before),
    unfixable: list(body.unfixable, ['what', 'evidence', 'fix']).filter(row => row.what), checked: field(body.checked), ...(sceneReads.length ? { sceneReads } : {}) };
}

/**
 * 交给 agent 的文件：参考图、视频抽帧（人物改写另附原片同一时刻）、底稿、素材表、拆解单、用户原话、提醒。
 * 11-11 多类型测：均分帧约 1.7 秒一张，快动作和转场都看漏；人物改写再附原片每 0.5 秒连拍、换装 / 换场点前后每 0.2 秒连拍（最多 6 处）。
 */
export async function finalFiles(input, { sheets }) {
  const files = [], rows = [];
  const grab = async (path, prefix, folder, times) => {
    mkdirSync(folder, { recursive: true });
    const names = await sheets.frames({ source: path, folder }, times, { maxSide: 720 });
    return names.map((name, i) => { const file = `${prefix}_${times[i].toFixed(1)}s.jpg`; files.push({ name: file, buffer: readFileSync(join(folder, name)) }); return file; });
  };
  const burst = async (path, label, folder, options) => {
    mkdirSync(folder, { recursive: true });
    const made = await sheets.contact({ source: path, folder }, options);
    return made.map(({ name, from, to }) => { const file = `${label}_${from.toFixed(1)}-${to.toFixed(1)}s.jpg`; files.push({ name: file, buffer: readFileSync(join(folder, name)) }); return file; });
  };
  for (const material of input.materials) {
    if (material.image) { files.push(material.image); rows.push(`${material.tag}：${material.purpose}，文件 ${material.image.name}`); continue; }
    if (material.video) {
      const n = material.tag.replace('@视频', ''), times = frameTimes(material.video.seconds);
      const frames = await grab(material.video.path, `视频${n}`, join(input.folder, `ref-${n}`), times);
      const own = input.kind === 'product' ? '原片本身（火山也会收到它）' : '动作参考';
      let row = `${material.tag}：${material.purpose}（${own}，${material.video.seconds.toFixed(1)} 秒），按时间抽帧：${frames.join('、')}`;
      if (material.video.source) {
        const { path, seconds } = material.video.source, folder = join(input.folder, `source-${n}`);
        const sourceFrames = await grab(path, '原片', folder, times.map(t => Math.round(Math.min(t, Math.max(0, seconds - 0.15)) * 10) / 10));
        row += `\n它的原片（真人实拍，火山收不到它，只给你核对）同一时刻：${sourceFrames.join('、')}`;
        const all = await burst(path, '原片连拍', join(folder, 'burst'), { end: seconds, prefix: 'all' });
        row += `\n原片连拍（每 0.5 秒一帧，图上印着秒数；看快动作和动作先后用）：${all.join('、')}`;
        const around = [];
        for (const [index, second] of planChangeSeconds(input.plan).filter(at => at > 0.2 && at < seconds - 0.2).slice(0, 6).entries()) {
          around.push(...await burst(path, '换点前后', join(folder, 'burst'), { start: Math.max(0, second - 0.6), end: Math.min(seconds - 0.05, second + 0.8),
            step: 0.2, columns: 7, rows: 1, area: 240 * 427, prefix: `change${index}` }));
        }
        if (around.length) row += `\n换装 / 换场点前后（每 0.2 秒一帧，看转场怎么转）：${around.join('、')}`;
      }
      rows.push(row); continue;
    }
    rows.push(`${material.tag}：${material.purpose}，这次没有文件`);
  }
  if (input.sceneTexts?.length) files.push(...await sceneTextFiles(input.sceneTexts, input.sourceVideo.path, join(input.folder, 'scene-text'), sheets));
  files.push({ name: '底稿.txt', buffer: Buffer.from(input.draft) }, { name: '素材表.txt', buffer: Buffer.from(rows.join('\n')) },
    { name: '拆解单.json', buffer: Buffer.from(JSON.stringify(input.plan ?? {}, null, 1)) }, { name: '用户原话.txt', buffer: Buffer.from(input.userText || '（没写）') });
  if (input.warnings?.length) files.push({ name: '提醒.txt', buffer: Buffer.from(input.warnings.map(text => `- ${text}`).join('\n')) });
  return files;
}

/**
 * finalizePrompt({ kind, draft, materials, plan, userText, warnings, settings, duration, folder }, { call, sheets, model, rules })
 * → { videoPrompt, finalized, changes, unfixable, checked, issues, note, elapsedMs }。rules(prompt) 返回问题列表。
 * agent 出错 / 回话坏 / 改完两轮都过不了规则：退回底稿，note 写清原因，绝不拿过不了规则的稿子当定稿。
 * 11-13 背景卡用文字（input.sceneTexts）：底稿里根本没有卡上的字，失败不能悄悄退底稿——整个再跑一次，还不行就报错、提示词不动。
 */
export async function finalizePrompt(input, deps) {
  const first = await finalizeOnce(input, deps);
  if (!input.sceneTexts?.length || first.finalized) return first;
  const again = await finalizeOnce(input, deps);
  if (again.finalized) return again;
  throw Error(`背景卡的字这次没写进去（${again.note.replace(/，先用程序底稿。$/, '')}），再点一次「生成提示词」。`);
}

async function finalizeOnce(input, { call, sheets, model, rules, timeoutMs = 10 * 60 * 1000 }) {
  const started = Date.now(), target = Math.round(input.duration);
  const fallback = note => ({ videoPrompt: input.draft, finalized: false, changes: [], unfixable: [], checked: '', issues: rules(input.draft), note, elapsedMs: Date.now() - started });
  let files;
  try { files = await finalFiles(input, { sheets }); } catch (error) { return fallback(`准备看图的文件没成功（${error.message}），先用程序底稿。`); }
  const s = input.settings ?? {};
  const ask = [`视频设置：${modelLabel(s.model)}，参考模式，${s.ratio ?? ''}，${s.resolution ?? ''}，${target} 秒，生成音频${s.audio ? '开' : '关'}。`,
    `当前目录一共 ${files.length} 个文件。请先把它们全部 Read 一遍，再按清单核对和定稿，最后只输出 JSON。`].join('\n');
  const system = finalSystem(input.kind, target, Boolean(input.sceneTexts?.length));
  const round = async (extraFiles, extraAsk) => parseFinal((await call({ system, prompt: extraAsk ? `${ask}\n${extraAsk}` : ask,
    files: [...files, ...extraFiles], model, timeoutMs })).text);
  let first;
  try { first = await round([], ''); } catch (error) { return fallback(`本机 agent 定稿没成功（${String(error.message).slice(0, 120)}），先用程序底稿。`); }
  let final = first, issues = rules(first.prompt);
  if (issues.length) {
    try {
      final = await round([{ name: '上次定稿.txt', buffer: Buffer.from(first.prompt) }],
        `上次定稿（上次定稿.txt）过不了程序检查，问题：${issues.join('；')}。在上次定稿基础上只改这些问题，其余不动，照同样格式输出 JSON。`);
      issues = rules(final.prompt);
    } catch (error) { return { ...fallback(`本机 agent 第二轮没成功（${String(error.message).slice(0, 120)}），先用程序底稿。`), unfixable: first.unfixable }; }
  }
  if (issues.length) return { ...fallback(`看图改过的稿子两次都没过程序检查（${issues.slice(0, 3).join('；')}），先用程序底稿。`), unfixable: final.unfixable };
  return { videoPrompt: final.prompt, finalized: true, changes: final.changes, unfixable: final.unfixable, checked: final.checked, issues: [], note: '', elapsedMs: Date.now() - started,
    ...(final.sceneReads ? { sceneReads: final.sceneReads } : {}) };
}

/** 给页面的提醒：改了几处一句话、改不了的逐条、退回底稿的原因。 */
export function finalNotes(result, agent = 'Claude') {
  const short = text => text.length > 40 ? `${text.slice(0, 40)}…` : text;
  return [result.note,
    result.changes.length ? `${agent} 看图改了 ${result.changes.length} 处：${result.changes.map(row => short(row.why || row.after)).join('；')}` : '',
    ...result.unfixable.map(row => `${agent} 看图发现改字解决不了：${row.what}${row.fix ? `（建议：${row.fix}）` : ''}`)].filter(Boolean);
}

/**
 * 两种「生成提示词」接口共用：本机 agent 看图定稿（调用前路由已用 ensureAgent 确认它就绪）；假模式原样回程序底稿。
 * finalize({ kind, input, draft: { videoPrompt, warnings }, rules, source, settings, env }) → { videoPrompt, warnings, issues, finalized, changes }。
 */
export function createFinalizer({ dataRoot, promptImages, media, sheets, fake, agentCall }) {
  return async function finalize({ kind, input, draft, rules, source = null, settings = {}, env }) {
    const texts = input.sceneTexts ?? [];
    if (fake && texts.length) {
      const videoPrompt = fakeSceneTexts(draft.videoPrompt, texts);
      return { ...draft, videoPrompt, issues: rules(videoPrompt), finalized: false, changes: [], sceneReads: sceneReadsOf(texts, texts.map(({ title }) => ({ title, read: FAKE_SCENE_READ }))) };
    }
    if (fake) return { ...draft, issues: rules(draft.videoPrompt), finalized: false, changes: [] };
    const agent = agentHealth(env), folder = rewriteFolder(dataRoot, input.cardId, true);
    try {
      let materials, clip = null;
      try {
        materials = await resolveFinalMaterials(input.materials, source, { promptImages, media });
        if (texts.length) clip = source ? media.checkSource(source) : null;
        if (texts.length && !clip) throw Error('这张视频卡没存原片，截不了背景卡对应的那一刻');
      } catch (error) {
        if (texts.length) throw Error(`背景卡的字这次没写进去（准备看图的素材没成功：${error.message}），再点一次「生成提示词」。`);
        const note = `准备看图的素材没成功（${error.message}），先用程序底稿。`;
        return { ...draft, warnings: [...draft.warnings, note], issues: rules(draft.videoPrompt), finalized: false, changes: [] };
      }
      const result = await finalizePrompt({ kind, draft: draft.videoPrompt, materials, plan: input.plan, userText: input.userText, warnings: draft.warnings,
        settings: { ...settings, model: settings.model ?? input.model }, duration: input.duration, folder,
        ...(texts.length ? { sceneTexts: sceneTextRows(texts, input.plan, clip.duration), sourceVideo: { path: clip.path } } : {}) },
      { call: agentCall(env), sheets, model: agent.agentModel, rules });
      return { ...draft, videoPrompt: result.videoPrompt, warnings: [...draft.warnings, ...finalNotes(result, agent.agentName)], issues: result.issues,
        finalized: result.finalized, changes: result.changes, ...(texts.length ? { sceneReads: sceneReadsOf(texts, result.sceneReads) } : {}) };
    } finally { removeRewrite(dataRoot, input.cardId); }
  };
}
