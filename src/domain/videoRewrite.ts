import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode, VideoCardData, Health } from '@/types';
import type { RewriteItem, RewritePlan, RewriteMaterial, VideoRewriteState } from '@/videoRewriteTypes';
import { newCard, newVideoCard, currentResult } from './cards';
import { rightOf, CARD_HEIGHT, CARD_WIDTH } from './placement';
import { linkId } from './refs';
import { VIDEO_RATIOS, videoModelOf, type VideoRatio } from './videoModels';
import { rewriteNodeHeight, rewriteSpot, type RewriteColumn } from './videoRewriteLayout';
import { SIZE_FROM_ASPECT, type AspectId } from './aspects';
import { rewriteImageTemplate } from './rewriteTemplates';
import { clothesFrameRegion, keptClothes, REWRITE_CLOTHES_ASPECT, rewriteClothesPrompt } from './videoRewriteClothes';
import type { MotionReference } from './motionReference';
import { FFMPEG_MISSING, missingDepthConfig, meshConfigProblem } from './health';
import { compareCard, compareSecond, frameAspect, type RewriteRow } from './rewriteRows';
import { rewritePeers } from './rewritePeers';

export const REWRITE_VIDEO_MODEL = 'doubao-seedance-2-5-260628';
/** 背景卡的用途以「背景」开头，小服务按这个检查提示词里有没有写它是场景；别写「去掉」（视频提示词禁用编辑词）。 */
export const REWRITE_BACKGROUND_PURPOSE = '背景';
export const REWRITE_BACKGROUND_PROMPT = '把这张图里所有的人去掉，补全被人挡住的地方；其他全部保持原样：机位、构图、家具、遮挡物、颜色和光线都不变。';
/** 10-30 用户定：不勾「背景和原片保持一致」时背景卡不自动出图，用途写新场景（和 server/videoRewrite/roles.mjs 两边一起改），深度就不采用原片的场景和东西。 */
export const REWRITE_NEW_SCENE_PURPOSE = '背景，换成新场景';
/** 和 server/videoRewrite/roles.mjs 两边一起改。 */
export const REWRITE_MESH_PURPOSE = '白模，参考人物动作、姿态、位置和机位';
export const REWRITE_NEW_SCENE_PROMPT = '（在这里写你想要的场景：地点、时间、光线），画面里不要人。';
type GraphArgs = { nodes: readonly CardNode[]; edges: readonly Edge[]; takeNumber: () => number; makeId: () => string };
const sameAsset = (a: AssetRef | null, b: AssetRef) => a?.id === b.id && a.type === b.type;
/** 11-11 起五列：原视频 → 深度（1）→ 原片截图（2）→ 要补的卡（3）→ 最终视频（4）；截图和卡一行一对。 */
const columnOf = (source: { x: number; y: number }, index: number) => Array.from({ length: index }).reduce<{ x: number; y: number }>(at => rightOf(at), source);

/**
 * 建卡前一次列出本机缺项，假模式不挡。
 * 11-17 用户定：火山 Key / TOS 不在这里查——拆解、深度、写词都不花火山的钱，出图、出片那一步小服务和面板才拦。
 */
export function rewriteStartProblem(health: Health, motionReference: MotionReference): string | null {
  if (health.fake) return null;
  const missing = [];
  if (motionReference === 'depth') missing.push(...missingDepthConfig(health.depth));
  const meshProblem = motionReference === 'mesh' ? meshConfigProblem(health.mesh) : null;
  const reasons = missing.length ? [`请在项目根目录的 .env.local 填好或检查 ${missing.join('、')}。`] : [];
  if (meshProblem) reasons.push(meshProblem);
  if (!health.ffmpegFound) reasons.push(FFMPEG_MISSING);
  if (motionReference === 'depth' && !health.ffprobeFound) reasons.push('没找到 ffprobe，请先安装含 ffprobe 的 ffmpeg 并加入 PATH。');
  return reasons.length ? `${reasons.join('')}还没开始改写，没建卡、没交单。` : null;
}

export function rewriteSourceProblem(source: AssetRef | null): string | null {
  return !source || source.media !== 'video' ? '先选一张有结果的视频卡。' :
    !Number.isFinite(source.seconds) || source.seconds! < 4 || source.seconds! > 30 ? '来源视频要在 4 到 30 秒之间。' : null;
}
export function rewriteRatio(source: AssetRef): VideoRatio {
  const ratio = source.width && source.height ? source.width / source.height : 16 / 9;
  return VIDEO_RATIOS.filter(value => value !== 'adaptive').reduce((best, value) => {
    const distance = (candidate: string) => { const [w, h] = candidate.split(':').map(Number); return Math.abs(Math.log(ratio / (w / h))); };
    return distance(value) < distance(best) ? value : best;
  }, '16:9') as VideoRatio;
}

/** 第一步先建媒体卡；拆解后把单子和用户原话存入新视频卡，供补图后写词。 */
export function startVideoRewrite({ source, nodes, edges, takeNumber, makeId, userText, motionReference = 'depth' }: GraphArgs & { source: CardNode; userText: string; motionReference?: MotionReference }) {
  const asset = currentResult(source.data);
  const problem = source.data.kind === 'video' ? rewriteSourceProblem(asset) : '先选一张有结果的视频卡。';
  if (problem || !asset) throw new Error(problem!);
  const batchId = makeId();
  const state: VideoRewriteState = { batchId, sourceId: source.id, source: { ...asset }, sourcePosition: { ...source.position },
    userText, motionReference, plan: null, ratio: rewriteRatio(asset), duration: asset.seconds!, targetDuration: Math.round(asset.seconds!), hasAudio: asset.hasAudio === true };
  const media = ensureRewriteMedia({ state, nodes: nodes.map(node => ({ ...node, selected: false })), edges, takeNumber, makeId });
  const unfinished = media.nodes.find(node => node.data.kind === 'video' && node.data.source === 'generate' &&
    node.data.rewriteSourceId === source.id && sameAsset(node.data.rewriteSource ?? null, asset) &&
    !node.data.rewriteKind && !node.data.rewritePlan && node.data.rewriteStatus && !node.data.results.length);
  const videoId = unfinished?.id ?? makeId();
  const card = unfinished?.data.kind === 'video' ? { ...unfinished.data } : newVideoCard('generate', takeNumber());
  card.rewriteId = batchId; card.rewriteSourceId = source.id; card.rewriteSource = { ...asset };
  card.rewriteMotionReference = motionReference;
  card.rewriteStatus = { status: 'pending' };
  card.video = rewriteVideoSettings(state);
  const next = unfinished ? media.nodes.map(node => node.id === videoId ? { ...node, data: card } : node)
    : [...media.nodes, { id: videoId, type: 'card' as const, position: rewriteSpot(columnOf(source.position, 4), media.nodes), data: card }];
  return { ...media, nodes: next, state: { ...media.state, videoId }, batchId };
}

/** 10-30 用户定：成片关着生成音频出，原片有声音时出好后由小服务配回原声（交单带 soundtrack，见 `videoSend.ts`）。 */
function rewriteVideoSettings(state: VideoRewriteState): VideoCardData['video'] {
  return { model: REWRITE_VIDEO_MODEL, mode: 'reference', ratio: state.ratio, resolution: '480p', duration: state.targetDuration, audio: false, count: 1 };
}

/** 按种类补同一来源的动作参考卡；depthId 沿用旧字段名，指向本次选中的参考卡。 */
function ensureRewriteMedia({ state: previous, nodes, edges, takeNumber, makeId }: GraphArgs & { state: VideoRewriteState }) {
  const state = { ...previous };
  const next = [...nodes]; const links = [...edges];
  const origin = rightOf(state.sourcePosition);
  const matchingSource = (node: CardNode) => node.data.mediaSource ? sameAsset(node.data.mediaSource, state.source) : links.some(edge => {
    if (edge.target !== node.id) return false;
    const upstream = next.find(candidate => candidate.id === edge.source);
    return upstream?.data.results.length === 1 && sameAsset(currentResult(upstream.data), state.source);
  });
  const motionReference = state.motionReference ?? 'depth';
  const matches = (node: CardNode) => node.data.kind === 'video' && node.data.source === motionReference && matchingSource(node);
  const existing = next.find(node => node.id === state.depthId && matches(node)) ?? next.find(matches);
  if (existing) state.depthId = existing.id;
  else {
    const id = makeId();
    const card = newVideoCard(motionReference, takeNumber());
    card.mediaSource = { ...state.source }; card.video.ratio = state.ratio;
    const child: CardNode = { id, type: 'card', position: origin, data: card };
    child.position = rewriteSpot(origin, next, rewriteNodeHeight(child)); next.push(child);
    if (next.some(node => node.id === state.sourceId)) links.push({ id: linkId(state.sourceId, id), source: state.sourceId, target: id });
    state.depthId = id;
  }
  return { nodes: next, edges: links, state, depthId: state.depthId };
}

const CARD_ORDER = ['人物', '衣服', '场景', '道具', '遮挡物', '其他'];
const byCardOrder = (a: RewriteItem, b: RewriteItem) => CARD_ORDER.indexOf(a.kind) - CARD_ORDER.indexOf(b.kind) || a.from - b.from;
/** 隔一段穿回的同一套只要一张图。 */
export function replacementItems(plan: RewritePlan) {
  return plan.items.filter(item => plan.replace.includes(item.id) && !(item.sameAs && plan.replace.includes(item.sameAs))).sort(byCardOrder);
}
/** 要铺图片卡的项：要换的，加上勾了「衣服和原片保持一致」时要从原片抽的衣服。 */
const cardItems = (state: VideoRewriteState) => [...replacementItems(state.plan!), ...(state.keepClothes ? keptClothes(state.plan!) : [])].sort(byCardOrder);
export function itemPurpose(item: RewriteItem, items: readonly RewriteItem[]) {
  const peers = items.filter(entry => entry.kind === item.kind).sort((a, b) => a.from - b.from);
  const number = peers.findIndex(entry => entry.id === item.id) + 1;
  if (item.kind === '衣服') return `衣服 ${number}（${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10} 秒穿）`;
  return `${item.kind}${peers.length > 1 ? ` ${number}` : ''}`;
}
/**
 * 11-06 用户定背景卡分三种（11-11 起放第 4 列，左边第 3 列放同一行的原片截图）：
 * frame 为空 = 不跟原片，背景卡空着等用户补；给了 compare 就在左边放一张原片对照截图（不连线，11-11 用户定）；
 * empty = 截图里没人，截图直接放进背景卡，不出图；
 * 其余 = 左边放截图卡连到背景卡，填好去人提示词等用户点生成（跟截图尺寸出图，剪断时跟视频比例）。
 * 原片换了地方时每个场景调一次（11-11 起背景换不换都这样）：第一张是 backgroundId，其余进 extraBackgroundIds，标题带序号。
 */
export function addRewriteBackground({ state, frame, compare, empty = false, second = 0, scene, nodes, edges, takeNumber, makeId }: GraphArgs & { state: VideoRewriteState; frame: AssetRef | null; compare?: AssetRef; empty?: boolean; second?: number; scene?: RewriteItem }) {
  const next = [...nodes];
  const newScene = !frame, erase = Boolean(frame) && !empty, extra = Boolean(state.backgroundId);
  const title = extra ? `背景 ${(state.extraBackgroundIds?.length ?? 0) + 2}` : '背景';
  const [w, h] = state.ratio.split(':').map(Number), frameHeight = Math.ceil(CARD_WIDTH * h / w) + 40;
  let frameId: string | undefined, compareId: string | undefined;
  if (frame && erase) {
    const frameCard = newCard('upload', 0, [{ ...frame }]);
    frameCard.title = second > 0 ? `原视频 ${Math.round(second * 10) / 10} 秒` : '原视频第一帧';
    frameId = makeId();
    next.push({ id: frameId, type: 'card', position: rewriteSpot(columnOf(state.sourcePosition, 2), next, frameHeight), data: frameCard });
  }
  if (newScene && compare) {
    compareId = makeId();
    next.push({ id: compareId, type: 'card', position: rewriteSpot(columnOf(state.sourcePosition, 2), next, frameHeight), data: compareCard(compare, title, second) });
  }
  const background = newCard('generate', takeNumber(), frame && !erase ? [{ ...frame }] : []);
  background.rewriteId = state.batchId; background.title = title;
  background.prompt = newScene ? REWRITE_NEW_SCENE_PROMPT : erase ? REWRITE_BACKGROUND_PROMPT : '';
  background.gen.aspect = state.ratio as AspectId;
  if (newScene) background.rewriteNewScene = true;
  if (scene) background.rewriteSceneId = scene.id;
  const aspect = frameAspect(state.source);
  if ((frameId || compareId) && aspect) background.emptyAspect = aspect;
  const backgroundId = makeId(), left = frameId ?? compareId;
  next.push({ id: backgroundId, type: 'card', position: rewriteSpot(columnOf(state.sourcePosition, 3), next, CARD_HEIGHT), data: background });
  return { nodes: next, edges: frameId ? [...edges, { id: linkId(frameId, backgroundId), source: frameId, target: backgroundId }] : [...edges],
    state: extra ? { ...state, extraBackgroundIds: [...(state.extraBackgroundIds ?? []), backgroundId] }
      : { ...state, ...(frameId ? { frameId } : {}), backgroundId, ...(newScene ? { newScene } : {}) },
    frameId, backgroundId, row: { ...(left ? { left } : {}), right: backgroundId } as RewriteRow };
}
const backgroundIdsOf = (state: VideoRewriteState) => state.backgroundId ? [state.backgroundId, ...(state.extraBackgroundIds ?? [])] : [];
export function rewriteMaterials(state: VideoRewriteState): RewriteMaterial[] {
  if (!state.plan) throw new Error('还没有拆解结果。');
  const items = cardItems(state), scenes = sceneItems(state.plan), offset = backgroundIdsOf(state).length;
  const { maxImages } = videoModelOf(REWRITE_VIDEO_MODEL)!;
  if (items.length + offset > maxImages) throw new Error(`参考图最多 ${maxImages} 张，请减少要换的项目${state.keepClothes ? '，或不勾「衣服和原片保持一致」' : ''}。`);
  return [...backgroundIdsOf(state).map((_, index) => ({ tag: `@图片${index + 1}`, purpose: state.newScene ? REWRITE_NEW_SCENE_PURPOSE : REWRITE_BACKGROUND_PURPOSE, ...(scenes[index] ? { itemId: scenes[index].id } : {}) })),
    ...items.map((item, index) => ({ tag: `@图片${index + 1 + offset}`, purpose: itemPurpose(item, items), itemId: item.id, originalDesc: item.desc })),
    ...(state.depthId ? [{ tag: '@视频1', purpose: state.motionReference === 'mesh' ? REWRITE_MESH_PURPOSE : '深度，参考机位、动作、空间和遮挡节奏' }] : [])];
}
/**
 * 拆解成功后按要换项铺卡：图片先填出图模板，视频留空，补齐图片后再生成提示词。
 * keptFrames 是要从原片抽的衣服的截图：左边放截图卡连到衣服卡，提示词已填好，等用户点生成（11-09 用户定不自动出图）。
 * compareFrames 是要换的人和衣服在原片同一刻的截图（11-11 用户定）：左边放一张只给人对照、不连线。
 * backgroundRows 是背景那几行（addRewriteBackground 返回的 row），排在最上面；返回的 imageColumn 按行排版。
 */
export function prepareRewriteCards({ state, nodes, edges, takeNumber, makeId, keptFrames = {}, compareFrames = {}, backgroundRows }: GraphArgs & {
  state: VideoRewriteState; keptFrames?: Record<string, AssetRef>; compareFrames?: Record<string, AssetRef>; backgroundRows?: RewriteRow[] }) {
  rewriteMaterials(state);
  const items = cardItems(state); const next = [...nodes], plan = state.plan!;
  const clothesIds: string[] = [], frameLinks: Edge[] = [], rows: RewriteRow[] = [];
  const col2 = columnOf(state.sourcePosition, 2), col3 = rightOf(col2), col4 = rightOf(col3);
  const imageIds: Record<string, string> = {};
  items.forEach(item => {
    const id = makeId(); const card = newCard('generate', takeNumber());
    card.rewriteId = state.batchId; card.rewriteItemId = item.id; card.rewriteItem = { ...item };
    card.prompt = rewriteImageTemplate(item.kind);
    card.gen.aspect = state.ratio as AspectId;
    const index = items.filter(other => other.kind === item.kind).findIndex(other => other.id === item.id) + 1;
    card.title = item.kind === '衣服' ? `衣服 ${index}（${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10} 秒）` : item.kind;
    const frame = keptFrames[item.id], compare = compareFrames[item.id], second = compareSecond(item, plan);
    let left: string | undefined;
    if (frame) {
      const frameCard = newCard('upload', 0, [{ ...frame }]); left = makeId();
      frameCard.title = `衣服 ${index} 截图（${Math.round(item.frame * 10) / 10} 秒）`;
      next.push({ id: left, type: 'card', position: rewriteSpot(col2, next, CARD_HEIGHT), data: frameCard });
      card.prompt = rewriteClothesPrompt(item, plan);
      card.gen.aspect = REWRITE_CLOTHES_ASPECT; card.gen.sizeFrom = SIZE_FROM_ASPECT;
      frameLinks.push({ id: linkId(left, id), source: left, target: id }); clothesIds.push(id);
    } else if (compare && second !== undefined) {
      left = makeId();
      next.push({ id: left, type: 'card', position: rewriteSpot(col2, next, CARD_HEIGHT), data: compareCard(compare, item.kind === '衣服' ? `衣服 ${index}` : card.title, second) });
    }
    const aspect = left ? frameAspect(state.source, clothesFrameRegion(item, plan)) : undefined;
    if (aspect) card.emptyAspect = aspect;
    next.push({ id, type: 'card', position: rewriteSpot(col3, next, CARD_HEIGHT), data: card }); imageIds[item.id] = id;
    rows.push({ ...(left ? { left } : {}), right: id });
  });
  const backgroundIds = backgroundIdsOf(state).filter(id => next.some(node => node.id === id));
  const existing = next.find(node => node.id === state.videoId && node.data.kind === 'video');
  const videoId = state.videoId ?? makeId();
  const card = existing?.data.kind === 'video' ? { ...existing.data } : newVideoCard('generate', takeNumber());
  card.rewriteId = state.batchId; card.rewriteSourceId = state.sourceId; card.rewriteSource = { ...state.source };
  card.rewritePlan = structuredClone(state.plan!); card.rewriteUserText = state.userText;
  card.rewriteMotionReference = state.motionReference ?? 'depth';
  card.rewriteChangeSeconds = planChangeSeconds(state.plan!);
  card.video = rewriteVideoSettings(state); card.prompt = '';
  if (state.keepClothes) card.rewriteKeepClothes = true;
  delete card.rewriteBusy; delete card.rewriteStatus;
  if (existing) next[next.indexOf(existing)] = { ...existing, data: card };
  else next.push({ id: videoId, type: 'card', position: rewriteSpot(col4, next), data: card });
  // 背景和要补的卡都按真实尺寸一行一行重排：图出来卡会变高，不排就压在一起、对不齐（11-06 假模式真页面看到的）。
  const allRows = [...(backgroundRows ?? backgroundIds.map((id): RewriteRow => ({ right: id }))), ...rows].filter(row => next.some(node => node.id === row.right));
  const rowIds = allRows.flatMap(row => row.left ? [row.left, row.right] : [row.right]);
  const imageColumn: RewriteColumn = { ids: rowIds, movableIds: rowIds, origin: col2, rows: allRows };
  const references = [...backgroundIds, ...Object.values(imageIds), state.depthId].filter((id): id is string => Boolean(id) && next.some(node => node.id === id));
  return { nodes: next, edges: [...edges, ...frameLinks, ...references.map(id => ({ id: linkId(id, videoId), source: id, target: videoId }))], videoId, imageIds, imageColumn, clothesIds };
}
/** 发送和免费检查依照当前入线编号。 */
export function videoRewriteMaterials(nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId: string): RewriteMaterial[] {
  const counts = { image: 0, video: 0, audio: 0 };
  const items = rewritePeers(nodes, edges, videoId);
  return edges.filter(edge => edge.target === videoId).flatMap(edge => {
    const node = nodes.find(candidate => candidate.id === edge.source);
    if (!node) return [];
    const kind = node.data.kind; const number = ++counts[kind];
    const item = node.data.kind === 'image' ? node.data.rewriteItem : undefined;
    const background = node.data.kind === 'image' && Boolean(node.data.rewriteId) && !item;
    const scene = node.data.kind === 'image' && node.data.rewriteNewScene ? REWRITE_NEW_SCENE_PURPOSE : REWRITE_BACKGROUND_PURPOSE;
    const mesh = node.data.source === 'mesh' || currentResult(node.data)?.mesh === true;
    return [{ tag: `@${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}${number}`,
      purpose: item ? itemPurpose(item, items) : background ? scene : kind === 'audio' ? '原声，作为背景音乐和节奏参考' : kind === 'video' ? mesh ? REWRITE_MESH_PURPOSE : '深度，参考机位、动作、空间和遮挡节奏' : node.data.title ?? '图片参考',
      ...(item ? { itemId: item.id, originalDesc: item.desc } : background && node.data.kind === 'image' && node.data.rewriteSceneId ? { itemId: node.data.rewriteSceneId } : {}) }];
  });
}
/** 换装点：除最早一套外每套衣服开始处；上一套结束前 0.3 秒到这一套开始之间有 changes 就用离开始最近的秒数（和 server/videoRewrite/rules.mjs 两边一起改）；动作、道具变化交给深度视频。 */
export function outfitChangeSeconds(plan: RewritePlan): number[] {
  const clothes = plan.items.filter(item => item.kind === '衣服');
  const marks = plan.changes.map(change => change.second);
  // 「最早一套」按人算：两个人第一套差零点几秒开始不是换装。
  const seconds = [...new Set(clothes.map(item => item.person ?? ''))].flatMap(owner => {
    const worn = clothes.filter(item => (item.person ?? '') === owner), first = Math.min(...worn.map(item => item.from));
    return [...new Set(worn.map(item => item.from).filter(start => start > first))].map(start => {
      const low = Math.min(start, Math.max(...worn.filter(item => item.from < start).map(item => item.to))) - 0.3;
      return marks.filter(mark => mark >= low && mark <= start).sort((a, b) => b - a)[0] ?? start;
    });
  });
  return [...new Set(seconds)].sort((a, b) => a - b);
}
/** 原片换了地方时拆解才带场景项，按时间排好（和 server/videoRewrite/rules.mjs 两边一起改）。 */
export function sceneItems(plan: RewritePlan): RewriteItem[] {
  const scenes = plan.items.filter(item => item.kind === '场景').sort((a, b) => a.from - b.from);
  return scenes.length > 1 ? scenes : [];
}
/** 要单独占一秒段的秒数：换装点 + 换场点。 */
export function planChangeSeconds(plan: RewritePlan): number[] {
  return [...new Set([...outfitChangeSeconds(plan), ...sceneItems(plan).slice(1).map(item => item.from)])].sort((a, b) => a - b);
}
/** 11-11：换新背景时只算还连着背景卡的场景，用户删掉多的那几段沿用前一张（和 server/videoRewrite/input.mjs 同名函数两边一起改）。 */
export function scenesInUse(plan: RewritePlan, materials: readonly RewriteMaterial[], textSceneIds: readonly string[] = []): RewritePlan {
  const fresh = materials.filter(row => row.purpose === REWRITE_NEW_SCENE_PURPOSE);
  if (!fresh.length) return plan;
  const linked = new Set([...fresh.map(row => row.itemId).filter(Boolean), ...textSceneIds]); // 11-13 用文字的段也算在用
  return { ...plan, items: plan.items.filter(item => item.kind !== '场景' || linked.has(item.id)) };
}
/** 要单独占一秒段的秒数；有拆解单就现算（10-26 前的卡存的是全部变化点），用户把时长改短后，超出的不再检查。 */
export function rewriteChangeSeconds(data: VideoCardData, materials: readonly RewriteMaterial[] = [], textSceneIds: readonly string[] = []): number[] {
  return (data.rewritePlan ? planChangeSeconds(scenesInUse(data.rewritePlan, materials, textSceneIds)) : data.rewriteChangeSeconds ?? []).filter(second => second < data.video.duration);
}
export function rewriteVideoHints(data: VideoCardData, nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId?: string): string[] {
  if (!data.rewriteId || data.rewriteKind === 'product') return [];
  const hints: string[] = [];
  if (data.video.model !== REWRITE_VIDEO_MODEL) hints.push('时间戳会失效，请改回 2.5。');
  const snapshot = data.rewriteSource; const sourceId = data.rewriteSourceId;
  const target = videoId ?? nodes.find(node => node.data === data)?.id;
  if (edges.some(edge => edge.target === target && (edge.source === sourceId || Boolean(snapshot && sameAsset(currentResult(nodes.find(node => node.id === edge.source)?.data ?? data), snapshot)))))
    hints.push('原视频含人脸，建议只连深度卡。');
  return hints;
}
