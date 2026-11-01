import type { Edge } from '@xyflow/react';
import type { AssetRef, CardNode, VideoCardData, Health } from '@/types';
import type { RewriteItem, RewritePlan, RewriteMaterial, VideoRewriteState } from '@/videoRewriteTypes';
import { newCard, newVideoCard, currentResult } from './cards';
import { rightOf, CARD_HEIGHT, CARD_WIDTH } from './placement';
import { linkId } from './refs';
import { VIDEO_RATIOS, type VideoRatio } from './videoModels';
import { rewriteNodeHeight, rewriteSpot, type RewriteColumn } from './videoRewriteLayout';
import type { AspectId } from './aspects';
import { rewriteImageTemplate } from './rewriteTemplates';
import type { MotionReference } from './motionReference';
import { missingDepthConfig, meshConfigProblem } from './health';

export const REWRITE_VIDEO_MODEL = 'doubao-seedance-2-5-260628';
/** 背景卡的用途以「背景」开头，小服务按这个检查提示词里有没有写它是场景；别写「去掉」（视频提示词禁用编辑词）。 */
export const REWRITE_BACKGROUND_PURPOSE = '背景';
export const REWRITE_BACKGROUND_PROMPT = '把这张图里所有的人去掉，补全被人挡住的地方；其他全部保持原样：机位、构图、家具、遮挡物、颜色和光线都不变。';
/** 10-30 用户定：不勾「背景和原片保持一致」时背景卡不自动出图，用途写新场景（和 server/videoRewrite/roles.mjs 两边一起改），深度就不采用原片的场景和东西。 */
export const REWRITE_NEW_SCENE_PURPOSE = '背景，换成新场景';
/** 和 server/videoRewrite/roles.mjs 两边一起改。 */
export const REWRITE_MESH_PURPOSE = '白模，参考人物动作、姿态、位置和机位';
export const REWRITE_NEW_SCENE_PROMPT = '把场景整个换成（在这里写你想要的场景：地点、时间、光线），画面里不要人；只照这张图的机位、拍摄远近和地面高度。';
const MAX_REWRITE_REFS = 8;
type GraphArgs = { nodes: readonly CardNode[]; edges: readonly Edge[]; takeNumber: () => number; makeId: () => string };
const sameAsset = (a: AssetRef | null, b: AssetRef) => a?.id === b.id && a.type === b.type;

/** 建任何卡和付费前一次列出缺项，假模式不挡。 */
export function rewriteStartProblem(health: Health, motionReference: MotionReference): string | null {
  if (health.fake) return null;
  const missing = [];
  if (!health.keyReady) missing.push('ARK_API_KEY（火山 Key）');
  if (!health.tosReady) missing.push('TOS 三项（TOS_ACCESS_KEY_ID、TOS_SECRET_ACCESS_KEY、TOS_BUCKET）');
  if (motionReference === 'depth') missing.push(...missingDepthConfig(health.depth));
  const meshProblem = motionReference === 'mesh' ? meshConfigProblem(health.mesh) : null;
  const reasons = missing.length ? [`请在项目根目录的 .env.local 填好或检查 ${missing.join('、')}。`] : [];
  if (meshProblem) reasons.push(meshProblem);
  if (!health.ffmpegFound) reasons.push('没找到 ffmpeg，请先配置 ffmpeg。');
  if (motionReference === 'depth' && !health.ffprobeFound) reasons.push('没找到 ffprobe，请先安装含 ffprobe 的 ffmpeg 并加入 PATH。');
  return reasons.length ? `${reasons.join('')}还没开始改写，没建卡、没交单、没花钱。` : null;
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
    !node.data.rewritePlan && node.data.rewriteStatus && !node.data.results.length);
  const videoId = unfinished?.id ?? makeId();
  const card = unfinished?.data.kind === 'video' ? { ...unfinished.data } : newVideoCard('generate', takeNumber());
  card.rewriteId = batchId; card.rewriteSourceId = source.id; card.rewriteSource = { ...asset };
  card.rewriteMotionReference = motionReference;
  card.rewriteStatus = { status: 'pending' };
  card.video = rewriteVideoSettings(state);
  const next = unfinished ? media.nodes.map(node => node.id === videoId ? { ...node, data: card } : node)
    : [...media.nodes, { id: videoId, type: 'card' as const, position: rewriteSpot(rightOf(rightOf(rightOf(source.position))), media.nodes), data: card }];
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

export function replacementItems(plan: RewritePlan) {
  const order = ['人物', '衣服', '场景', '道具', '遮挡物', '其他'];
  return plan.items.filter(item => plan.replace.includes(item.id)).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.from - b.from);
}
function itemPurpose(item: RewriteItem, items: readonly RewriteItem[]) {
  const peers = items.filter(entry => entry.kind === item.kind).sort((a, b) => a.from - b.from);
  const number = peers.findIndex(entry => entry.id === item.id) + 1;
  if (item.kind === '衣服') return `衣服 ${number}（${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10} 秒穿）`;
  return `${item.kind}${peers.length > 1 ? ` ${number}` : ''}`;
}
/** 点开始就截好第一帧：第 2 列放第一帧卡，第 3 列最上面放背景卡（跟第一帧尺寸出图，剪断第一帧时跟视频比例），第一帧连背景。 */
export function addRewriteBackground({ state, frame, nodes, edges, takeNumber, makeId, newScene = false }: GraphArgs & { state: VideoRewriteState; frame: AssetRef; newScene?: boolean }) {
  const next = [...nodes];
  const frameCard = newCard('upload', 0, [{ ...frame }]); frameCard.title = '原视频第一帧';
  const [w, h] = state.ratio.split(':').map(Number);
  const frameId = makeId();
  next.push({ id: frameId, type: 'card', position: rewriteSpot(rightOf(state.sourcePosition), next, Math.ceil(CARD_WIDTH * h / w) + 40), data: frameCard });
  const background = newCard('generate', takeNumber());
  background.rewriteId = state.batchId; background.title = '背景';
  background.prompt = newScene ? REWRITE_NEW_SCENE_PROMPT : REWRITE_BACKGROUND_PROMPT;
  background.gen.aspect = state.ratio as AspectId;
  if (newScene) background.rewriteNewScene = true;
  const backgroundId = makeId();
  next.push({ id: backgroundId, type: 'card', position: rewriteSpot(rightOf(rightOf(state.sourcePosition)), next, CARD_HEIGHT), data: background });
  return { nodes: next, edges: [...edges, { id: linkId(frameId, backgroundId), source: frameId, target: backgroundId }],
    state: { ...state, frameId, backgroundId, ...(newScene ? { newScene } : {}) }, frameId, backgroundId };
}
export function rewriteMaterials(state: VideoRewriteState): RewriteMaterial[] {
  if (!state.plan) throw new Error('还没有拆解结果。');
  const items = replacementItems(state.plan), offset = state.backgroundId ? 1 : 0;
  if (items.length + offset + (state.depthId ? 1 : 0) > MAX_REWRITE_REFS) throw new Error('图和视频加起来最多 8 个参考，请减少要换的项目。');
  return [...(state.backgroundId ? [{ tag: '@图片1', purpose: state.newScene ? REWRITE_NEW_SCENE_PURPOSE : REWRITE_BACKGROUND_PURPOSE }] : []),
    ...items.map((item, index) => ({ tag: `@图片${index + 1 + offset}`, purpose: itemPurpose(item, items), itemId: item.id, originalDesc: item.desc })),
    ...(state.depthId ? [{ tag: '@视频1', purpose: state.motionReference === 'mesh' ? REWRITE_MESH_PURPOSE : '深度，参考机位、动作、空间和遮挡节奏' }] : [])];
}
/** 拆解成功后按要换项铺卡：图片先填出图模板，视频留空，补齐图片后再生成提示词。 */
export function prepareRewriteCards({ state, nodes, edges, takeNumber, makeId }: GraphArgs & { state: VideoRewriteState }) {
  rewriteMaterials(state);
  const items = replacementItems(state.plan!); const next = [...nodes];
  const col3 = rightOf(rightOf(state.sourcePosition)); const col4 = rightOf(col3);
  const imageIds: Record<string, string> = {};
  items.forEach(item => {
    const id = makeId(); const card = newCard('generate', takeNumber());
    card.rewriteId = state.batchId; card.rewriteItemId = item.id; card.rewriteItem = { ...item };
    card.prompt = rewriteImageTemplate(item.kind);
    card.gen.aspect = state.ratio as AspectId;
    const index = items.filter(other => other.kind === item.kind).findIndex(other => other.id === item.id) + 1;
    card.title = item.kind === '衣服' ? `衣服 ${index}（${Math.round(item.from * 10) / 10}-${Math.round(item.to * 10) / 10} 秒）` : item.kind;
    next.push({ id, type: 'card', position: rewriteSpot(col3, next, CARD_HEIGHT), data: card }); imageIds[item.id] = id;
  });
  const backgroundId = state.backgroundId && next.some(node => node.id === state.backgroundId) ? state.backgroundId : undefined;
  const existing = next.find(node => node.id === state.videoId && node.data.kind === 'video');
  const videoId = state.videoId ?? makeId();
  const card = existing?.data.kind === 'video' ? { ...existing.data } : newVideoCard('generate', takeNumber());
  card.rewriteId = state.batchId; card.rewriteSourceId = state.sourceId; card.rewriteSource = { ...state.source };
  card.rewritePlan = structuredClone(state.plan!); card.rewriteUserText = state.userText;
  card.rewriteMotionReference = state.motionReference ?? 'depth';
  card.rewriteChangeSeconds = outfitChangeSeconds(state.plan!);
  card.video = rewriteVideoSettings(state); card.prompt = '';
  delete card.rewriteBusy; delete card.rewriteStatus;
  if (existing) next[next.indexOf(existing)] = { ...existing, data: card };
  else next.push({ id: videoId, type: 'card', position: rewriteSpot(col4, next), data: card });
  const imageColumn: RewriteColumn = { ids: [...(backgroundId ? [backgroundId] : []), ...Object.values(imageIds)], movableIds: Object.values(imageIds), origin: col3 };
  const references = [...imageColumn.ids, state.depthId].filter((id): id is string => Boolean(id) && next.some(node => node.id === id));
  return { nodes: next, edges: [...edges, ...references.map(id => ({ id: linkId(id, videoId), source: id, target: videoId }))], videoId, imageIds, imageColumn };
}
/** 发送和免费检查依照当前入线编号。 */
export function videoRewriteMaterials(nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId: string): RewriteMaterial[] {
  const counts = { image: 0, video: 0, audio: 0 };
  const items = edges.filter(edge => edge.target === videoId).flatMap(edge => {
    const node = nodes.find(candidate => candidate.id === edge.source);
    return node?.data.kind === 'image' && node.data.rewriteItem ? [node.data.rewriteItem] : [];
  });
  return edges.filter(edge => edge.target === videoId).flatMap(edge => {
    const node = nodes.find(candidate => candidate.id === edge.source);
    if (!node) return [];
    const kind = node.data.kind; const number = ++counts[kind];
    const item = node.data.kind === 'image' ? node.data.rewriteItem : undefined;
    const background = node.data.kind === 'image' && Boolean(node.data.rewriteId) && !item;
    const scene = node.data.kind === 'image' && node.data.rewriteNewScene ? REWRITE_NEW_SCENE_PURPOSE : REWRITE_BACKGROUND_PURPOSE;
    const mesh = node.data.source === 'mesh' || currentResult(node.data)?.mesh === true;
    return [{ tag: `@${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}${number}`,
      purpose: item ? itemPurpose(item, items) : background ? scene : kind === 'audio' ? '原声，作为背景音乐和节奏参考' : kind === 'video' ? mesh ? REWRITE_MESH_PURPOSE : '深度，参考机位、动作、空间和遮挡节奏' : node.data.title ?? '图片参考', ...(item ? { itemId: item.id, originalDesc: item.desc } : {}) }];
  });
}
/** 换装点：除最早一套外每套衣服开始处；上一套结束前 0.3 秒到这一套开始之间有 changes 就用离开始最近的秒数（和 server/videoRewrite/rules.mjs 两边一起改）；动作、道具变化交给深度视频。 */
export function outfitChangeSeconds(plan: RewritePlan): number[] {
  const clothes = plan.items.filter(item => item.kind === '衣服');
  const first = Math.min(...clothes.map(item => item.from));
  const marks = plan.changes.map(change => change.second);
  const seconds = [...new Set(clothes.map(item => item.from).filter(start => start > first))].map(start => {
    const low = Math.min(start, Math.max(...clothes.filter(item => item.from < start).map(item => item.to))) - 0.3;
    return marks.filter(mark => mark >= low && mark <= start).sort((a, b) => b - a)[0] ?? start;
  });
  return [...new Set(seconds)].sort((a, b) => a - b);
}
/** 要单独占一秒段的换装秒数；有拆解单就按衣服时段现算（10-26 前的卡存的是全部变化点），用户把时长改短后，超出的不再检查。 */
export function rewriteChangeSeconds(data: VideoCardData): number[] {
  return (data.rewritePlan ? outfitChangeSeconds(data.rewritePlan) : data.rewriteChangeSeconds ?? []).filter(second => second < data.video.duration);
}
export function rewriteVideoHints(data: VideoCardData, nodes: readonly CardNode[], edges: readonly Pick<Edge, 'source' | 'target'>[], videoId?: string): string[] {
  if (!data.rewriteId) return [];
  const hints: string[] = [];
  if (data.video.model !== REWRITE_VIDEO_MODEL) hints.push('时间戳会失效，请改回 2.5。');
  const snapshot = data.rewriteSource; const sourceId = data.rewriteSourceId;
  const target = videoId ?? nodes.find(node => node.data === data)?.id;
  if (edges.some(edge => edge.target === target && (edge.source === sourceId || Boolean(snapshot && sameAsset(currentResult(nodes.find(node => node.id === edge.source)?.data ?? data), snapshot)))))
    hints.push('原视频含人脸，建议只连深度卡。');
  return hints;
}
