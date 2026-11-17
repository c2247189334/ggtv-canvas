import type { Edge } from '@xyflow/react';
import type { CardGroup, CardNode, Health, VideoCardData } from '@/types';
import type { ProductPlan, ProductRole, ProductState } from '@/productRemakeTypes';
import { currentResult, newCard, newVideoCard } from './cards';
import { rewriteRatio, rewriteSourceProblem } from './videoRewrite';
import { CARD_WIDTH, rightOf } from './placement';
import { rewriteNodeHeight, rewriteSpot } from './videoRewriteLayout';
import { groupBounds, groupsIn } from './groups';
import { linkId } from './refs';
import { FFMPEG_MISSING } from './health';

type GraphArgs = { nodes: readonly CardNode[]; edges: readonly Edge[]; takeNumber: () => number; makeId: () => string };
const cleanStatus = ({ rewriteBusy: _busy, rewriteStatus: _status, ...data }: VideoCardData) => data;
const connect = (source: string, target: string): Edge => ({ id: linkId(source, target), source, target });

/** 11-17 用户定：火山 Key / TOS 等出图、出片那一步再拦，开拆只要本机 ffmpeg（拆解看帧用）。 */
export function productStartProblem(health: Health): string | null {
  if (health.fake || health.ffmpegFound) return null;
  return `${FFMPEG_MISSING}还没开始拆解，没建卡、没交单。`;
}
export function productVideoSettings(source: ProductState['source']): VideoCardData['video'] {
  const long = source.seconds! > 15;
  return { model: long ? 'doubao-seedance-2-5-260628' : 'doubao-seedance-2-0-260128', mode: 'reference',
    ratio: rewriteRatio(source), resolution: '480p', duration: Math.max(4, Math.min(long ? 30 : 15, Math.ceil(source.seconds!))), audio: false, count: 1 };
}
export function startProductRemake({ source, userText, nodes, edges, makeId, takeNumber }: GraphArgs & { source: CardNode; userText: string }) {
  const asset = currentResult(source.data);
  const problem = source.data.kind === 'video' ? rewriteSourceProblem(asset) : '先选一张有结果的视频卡。';
  if (problem || !asset) throw Error(problem!);
  const unfinished = nodes.find(n => n.data.kind === 'video' && n.data.rewriteKind === 'product' && n.data.rewriteSourceId === source.id &&
    n.data.rewriteSource?.id === asset.id && n.data.rewriteSource.type === asset.type && !n.data.productPlan && n.data.rewriteStatus && !n.data.results.length);
  const batchId = makeId(), videoId = unfinished?.id ?? makeId();
  const position = unfinished?.position ?? rewriteSpot(rightOf(rightOf(source.position)), nodes);
  const base = unfinished?.data.kind === 'video' ? unfinished.data : newVideoCard('generate', takeNumber());
  const data: VideoCardData = { ...base, rewriteKind: 'product', rewriteId: batchId, rewriteSourceId: source.id,
    rewriteSource: { ...asset }, rewriteUserText: userText, rewriteStatus: { status: 'pending' }, video: productVideoSettings(asset), productAutoPosition: { ...position } };
  const node: CardNode = { id: videoId, type: 'card', position, data };
  return { nodes: [...nodes.filter(n => n.id !== videoId).map(n => ({ ...n, selected: false })), node],
    edges: [...edges.filter(e => e.source !== source.id || e.target !== videoId), connect(source.id, videoId)], videoId,
    state: { batchId, videoId, sourceId: source.id, source: { ...asset }, userText } satisfies ProductState };
}
const label = (id: string, name = '', where = '') => `商品${id}${name ? ` · ${name}` : ''}${where ? `（${where}）` : ''}`;
function imageCard(args: GraphArgs, videoId: string, group: CardGroup | null, name: string, position: CardNode['position'], ordinal = 1, where = ''): CardNode {
  const data = newCard('generate', args.takeNumber());
  data.rewriteId = videoId;
  data.title = group ? `${group.name}${ordinal > 1 ? ` ${ordinal}` : ''}` : '背景';
  data.productRole = group ? { role: 'product', productId: group.productId, videoId, name, ...(where ? { where } : {}) } : { role: 'background', videoId };
  if (group) data.group = group;
  return { id: args.makeId(), type: 'card', position, data };
}
/** 11-04 晚：空卡上给人认的原片样子，取所属视频拆解单里这组 look 的第一小句、最多 16 字；只显示，不进提示词。 */
export function productOriginalLook(nodes: readonly CardNode[], role?: ProductRole): string {
  if (role?.role !== 'product') return '';
  const video = nodes.find(n => n.id === role.videoId);
  const look = video?.data.kind === 'video' ? video.data.productPlan?.products.find(p => p.id === role.productId)?.look : '';
  const first = [...(look ?? '').split(/[，,；;。]/)[0].trim()];
  return first.length > 16 ? `${first.slice(0, 16).join('')}…` : first.join('');
}
export function productEmptyText(data: { productRole?: { role: string; name?: string; where?: string; sameAs?: string } }, look = ''): string | null {
  const role = data.productRole;
  if (!role) return null;
  if (role.role === 'background') return '传：背景照（只照它的场景颜色、材质和光线）';
  const seen = look ? `原片里这组：${look}\n` : '';
  if (role.sameAs) return `${seen}跟商品${role.sameAs}一样，不用传图`;
  if (look) return `${seen}传：要换成的${role.name || '商品'}实物照（一张一个角度：正面、侧面、鞋底…）`;
  return role.where ? `传：${role.where}那组${role.name || '商品'}要换成的实物照（一张一个角度：正面、侧面、鞋底…）`
    : `传：${role.name || '商品'}的实物照（一张一个角度：正面、侧面、鞋底…）`;
}
export function prepareProductCards(args: GraphArgs & { state: ProductState; plan: ProductPlan }) {
  const { state, plan } = args;
  const source = args.nodes.find(n => n.id === state.sourceId);
  const output = args.nodes.find(n => n.id === state.videoId);
  if (!output || output.data.kind !== 'video') throw Error('新视频卡已经不在了。');
  const products = plan.products.length ? plan.products : [{ id: 'A', name: state.userText, look: '', pairs: 0, pieces: 0, layout: '' }];
  const actualPlan = { ...plan, products, unsure: [...plan.unsure, ...(!plan.products.length ? [`拆解没认出${state.userText}，请核一眼`] : [])] };
  const nodes = args.nodes.map(n => ({ ...n, selected: n.id === state.videoId, ...(n.id === output.id ? { data: {
    ...cleanStatus(output.data as VideoCardData), productPlan: actualPlan, rewriteUserText: state.userText, rewriteWarnings: actualPlan.unsure } } : {}) }));
  const edges = [...args.edges];
  let at = rightOf(source?.position ?? { x: output.position.x - 760, y: output.position.y });
  for (const product of products) {
    const group: CardGroup = { id: args.makeId(), name: label(product.id, product.name, product.where), productId: product.id, videoId: state.videoId };
    at = rewriteSpot(at, nodes, 260);
    const image = imageCard({ ...args, nodes }, state.videoId, group, product.name, at, 1, product.where);
    nodes.push({ ...image, selected: false }); edges.push(connect(image.id, state.videoId));
    at = { ...at, y: at.y + rewriteNodeHeight(image) + 120 };
  }
  return { nodes, edges, videoId: state.videoId };
}
function owner(args: GraphArgs, videoId: string) {
  const video = args.nodes.find(n => n.id === videoId);
  if (video?.data.kind !== 'video' || video.data.rewriteKind !== 'product') throw Error('所属视频卡已经不在了。');
  if (!video.data.productPlan || video.data.rewriteBusy || video.data.rewriteStatus) throw Error('先等拆解完成，再添加商品或背景。');
  if (args.edges.filter(e => e.target === videoId).length >= 8) throw Error('图和视频加起来最多 8 个参考。');
  return video;
}
export function addProductImage(args: GraphArgs & { groupId: string }) {
  const members = args.nodes.filter(n => n.data.group?.id === args.groupId);
  const group = members[0]?.data.group;
  if (!group?.productId || !group.videoId) throw Error('这不是商品组。');
  owner(args, group.videoId);
  const role = members.flatMap(n => n.data.kind === 'image' && n.data.productRole ? [n.data.productRole] : [])[0];
  if (role?.sameAs) throw Error(`这组设成了「跟商品${role.sameAs}一样」，要传自己的图先点一下取消。`);
  const last = members.reduce((a, b) => a.position.x > b.position.x ? a : b);
  const image = imageCard(args, group.videoId, group, role?.name ?? '',
    { x: last.position.x + (last.measured?.width ?? last.width ?? CARD_WIDTH) + 24, y: last.position.y }, members.length + 1, role?.where);
  const right = image.position.x + CARD_WIDTH + 100;
  const nodes = args.nodes.map(n => {
    if (n.id !== group.videoId || n.data.kind !== 'video' || !n.data.productAutoPosition) return n;
    const auto = n.data.productAutoPosition;
    if (auto.x !== n.position.x || auto.y !== n.position.y || n.position.x >= right) return n;
    const position = { ...n.position, x: right };
    return { ...n, position, data: { ...n.data, productAutoPosition: position } };
  });
  return { nodes: [...nodes, image], edges: [...args.edges, connect(image.id, group.videoId)] };
}
export function addProductGroup(args: GraphArgs & { videoId: string }) {
  const video = owner(args, args.videoId);
  const groups = groupsIn(args.nodes).filter(g => g.videoId === args.videoId && g.productId);
  const ids = [...groups.map(g => g.productId!), ...(video.data.kind === 'video' ? video.data.productPlan!.products.map(p => p.id) : [])];
  const ordinal = (id: string) => [...id].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0);
  const index = Math.max(0, ...ids.map(ordinal));
  const productId = productLetter(index);
  const group = { id: args.makeId(), name: label(productId), productId, videoId: args.videoId };
  const image = imageCard(args, args.videoId, group, '', nextProductPosition(args.nodes, args.videoId, video));
  return { nodes: [...args.nodes, image], edges: [...args.edges, connect(image.id, args.videoId)] };
}
function productLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : productLetter(Math.floor(index / 26) - 1) + productLetter(index % 26);
}
function nextProductPosition(nodes: readonly CardNode[], videoId: string, video: CardNode) {
  const related = nodes.filter(n => n.data.kind === 'image' && n.data.productRole?.videoId === videoId);
  const x = related[0]?.position.x ?? video.position.x - 380;
  const bottom = related.length ? Math.max(...related.map(n => n.position.y + rewriteNodeHeight(n) + 100)) : video.position.y;
  const groups = groupsIn(related).map(g => groupBounds([...nodes], g.id)!);
  return { x, y: Math.max(bottom, ...groups.map(g => g.y + g.height + 80)) };
}
export function hasProductBackground(nodes: readonly CardNode[], videoId: string) {
  return nodes.some(n => n.data.kind === 'image' && n.data.productRole?.videoId === videoId && n.data.productRole.role === 'background');
}
export function addProductBackground(args: GraphArgs & { videoId: string }) {
  if (hasProductBackground(args.nodes, args.videoId)) return { nodes: [...args.nodes], edges: [...args.edges] };
  const video = owner(args, args.videoId);
  const image = imageCard(args, args.videoId, null, '', nextProductPosition(args.nodes, args.videoId, video));
  return { nodes: [...args.nodes, image], edges: [...args.edges, connect(image.id, args.videoId)] };
}
/**
 * 「跟哪组一样」：这组空卡剪掉连线、提示词照那组的图。11-04 晚真拆鞋店那条分出 5 组（台面 3 组 + 背景 2 组），
 * 背景两组要跟台面上同色那组，所以能选同一张视频卡下任意一组；正在跟别人的组不能当目标（不连成串）；组里已有图时只能取消。
 */
export function productSameAsState(nodes: readonly CardNode[], groupId: string):
  { current: string | null; options: Array<{ id: string; label: string }>; hasImage: boolean } | null {
  const members = nodes.filter(n => n.data.group?.id === groupId);
  const group = members[0]?.data.group;
  if (!group?.productId || !group.videoId) return null;
  const roles = nodes.flatMap(n => n.data.kind === 'image' && n.data.productRole && n.data.productRole.videoId === group.videoId ? [n.data.productRole] : []);
  const current = members.flatMap(n => n.data.kind === 'image' && n.data.productRole?.sameAs ? [n.data.productRole.sameAs] : [])[0] ?? null;
  const following = new Set(roles.filter(r => r.sameAs).map(r => r.productId));
  const ordinal = (id: string) => [...id].reduce((sum, c) => sum * 26 + c.charCodeAt(0) - 64, 0);
  const options = groupsIn(nodes).filter(g => g.videoId === group.videoId && g.productId && g.productId !== group.productId && !following.has(g.productId))
    .sort((a, b) => ordinal(a.productId!) - ordinal(b.productId!)).map(g => ({ id: g.productId!, label: g.name }));
  if (!options.length && !current) return null;
  return { current, options, hasImage: members.some(n => Boolean(currentResult(n.data))) };
}
export function setProductSameAs(args: GraphArgs & { groupId: string; target: string | null }) {
  const state = productSameAsState(args.nodes, args.groupId);
  if (!state) throw Error('这组没有别的商品组可以跟。');
  if (args.target && !state.options.some(option => option.id === args.target)) throw Error(`不能跟商品${args.target}一样（它自己在跟别的组）。`);
  if (args.target && !state.current && state.hasImage) throw Error('这组已经有图了，会按自己的图换；不用再跟别的组一样。');
  const members = args.nodes.filter(n => n.data.group?.id === args.groupId);
  const videoId = members[0].data.group!.videoId!;
  const ids = new Set(members.map(n => n.id));
  const edges = args.edges.filter(e => !(ids.has(e.source) && e.target === videoId));
  owner({ ...args, edges }, videoId);
  if (!args.target && edges.filter(e => e.target === videoId).length + members.length > 8) throw Error('图和视频加起来最多 8 个参考。');
  const nodes = args.nodes.map(n => {
    if (!ids.has(n.id) || n.data.kind !== 'image' || !n.data.productRole) return n;
    const { sameAs: _old, ...role } = n.data.productRole;
    return { ...n, data: { ...n.data, productRole: args.target ? { ...role, sameAs: args.target } : role } };
  });
  if (args.target) return { nodes, edges };
  return { nodes, edges: state.current ? [...edges, ...members.map(n => connect(n.id, videoId))] : [...args.edges] };
}
