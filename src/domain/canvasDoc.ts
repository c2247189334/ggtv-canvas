/**
 * 画布存档 ↔ 画布库的卡片和连线。
 * 只存该存的（位置、连线、卡片内容），选中、拖动中、量出来的尺寸这类临时状态不存。
 * 读的时候每张卡都过一遍检查：读坏的丢掉，设置读坏了用默认值 —— 存档不会把页面弄崩。
 */
import type { Edge } from "@xyflow/react";
import { normalizeGen } from "@/domain/normalizeGen";
import { linkId } from "@/domain/refs";
import { DEFAULT_VIDEO_SETTINGS, normalizeVideoSettings } from "./videoModels";
import { validAssetId } from "./videoPanel";
import { readRewriteItem, readRewriteStatus, readRewriteChangeSeconds, readRewritePlan, readRewriteMotionReference } from './videoRewriteDoc';
import { readProductPlan, readProductRole } from './productRemakeDoc';
import type { AssetRef, CanvasDoc, CardData, CardGroup, CardNode, CardSource } from "@/types";
import { readSentInputs } from './staleInputs';
import { MAX_SCENE_TEXT, readSceneReads } from './rewriteTextScene';

export type CanvasMeta = { id: string; name: string };

export function toDoc(meta: CanvasMeta, nodes: readonly CardNode[], edges: readonly Edge[]): CanvasDoc {
  return {
    id: meta.id,
    name: meta.name,
    nodes: nodes.map((n) => {
      const { phase: _phase, jobWarning: _jobWarning, rewriteBusy: _rewriteBusy, ...data } = n.data;
      const saved = data.kind === 'video' && data.productAutoPosition ? { ...data, productAutoPosition: {
        x: Math.round(data.productAutoPosition.x), y: Math.round(data.productAutoPosition.y) } } : data;
      return { id: n.id, x: Math.round(n.position.x), y: Math.round(n.position.y), data: saved };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target }))
  };
}

const SOURCES: readonly CardSource[] = ["upload", "work", "generate", "extracted", "depth", "mesh"];
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function readGroup(raw: unknown): CardGroup | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { id, name, characterId, productId, videoId } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim() || typeof name !== 'string' || !name.trim()) return undefined;
  if (characterId !== undefined && (typeof characterId !== 'string' || !characterId.trim())) return undefined;
  return { id, name, ...(characterId === undefined ? {} : { characterId }),
    ...(typeof productId === 'string' && /^[A-Z]+$/.test(productId) && typeof videoId === 'string' && videoId ? { productId, videoId } : {}) };
}

// 下面都先取成局部变量再判断：对「unknown 对象的属性」直接判断，类型收窄不一定生效。
function readRef(raw: unknown): AssetRef | null {
  if (!raw || typeof raw !== "object") return null;
  const { type, id, media, seconds, width, height, hasAudio, fps, depth, mesh } = raw as Record<string, unknown>;
  if ((type !== "upload" && type !== "work") || typeof id !== "string") return null;
  const dimension = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0;
  return { type, id, ...((media === "video" || media === "audio") ? { media, ...(dimension(seconds) ? { seconds: seconds as number } : {}),
    ...(media === "video" ? { ...(dimension(width) && dimension(height) ? { width: width as number, height: height as number } : {}),
      ...(typeof hasAudio === "boolean" ? { hasAudio } : {}), ...(fps === null || dimension(fps) ? { fps: fps as number | null } : {}),
      ...(typeof depth === "boolean" ? { depth } : {}), ...(typeof mesh === "boolean" ? { mesh } : {}) } : {}) } : {}) };
}

export function readCard(raw: unknown): CardData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.kind !== undefined && d.kind !== "image" && d.kind !== "video" && d.kind !== "audio") return null;
  const source = d.source;
  if (!SOURCES.includes(source as CardSource)) return null;
  const { number: cardNumber, page, prompt, note } = d;
  const unnumbered = (source === 'upload' || source === 'work') && typeof d.title === 'string' && Boolean(d.title) && cardNumber === 0;
  const results = Array.isArray(d.results) ? d.results.map(readRef).filter((r): r is AssetRef => r !== null) : [];
  const common = {
    ...(readGroup(d.group) ? { group: readGroup(d.group) } : {}),
    source: source as CardSource,
    number: unnumbered ? 0 : isInt(cardNumber) && cardNumber > 0 ? cardNumber : 1,
    ...(typeof d.title === "string" && d.title ? { title: d.title } : {}),
    results,
    page: isInt(page) ? Math.min(Math.max(0, page), Math.max(0, results.length - 1)) : 0,
    prompt: typeof prompt === "string" ? prompt : "",
    jobs: Array.isArray(d.jobs) ? d.jobs.filter((j): j is string => typeof j === "string") : [],
    note: typeof note === "string" ? note : null,
    ...(typeof d.depthJobId === "string" ? { depthJobId: d.depthJobId } : {}),
    ...(typeof d.startedAt === "string" ? { startedAt: d.startedAt } : {}),
    ...(d.rewriteTask === 'product' ? { rewriteTask: 'product' as const } : {}),
    ...(readRef(d.mediaSource)?.media === "video" ? { mediaSource: readRef(d.mediaSource)! } : {}),
    ...(Array.isArray(d.blocked) ? { blocked: d.blocked.filter((n): n is number => isInt(n) && n >= 1) } : {}),
    ...(readSentInputs(d.sentInputs) ? { sentInputs: readSentInputs(d.sentInputs) } : {})
  };
  if (d.kind === "audio") return { ...common, kind: "audio" };
  if (d.kind === "video") {
    const settings = d.video && typeof d.video === "object" ? d.video as Record<string, unknown> : {};
    const input = { ...DEFAULT_VIDEO_SETTINGS, ...settings };
    return { ...common, kind: "video", ...(typeof d.rewriteId === 'string' ? { rewriteId: d.rewriteId, rewriteMotionReference: readRewriteMotionReference(d.rewriteMotionReference) } : {}),
      ...(d.rewriteKeepClothes === true ? { rewriteKeepClothes: true as const } : {}),
      ...(readSceneReads(d.rewriteSceneReads) ? { rewriteSceneReads: readSceneReads(d.rewriteSceneReads) } : {}),
      ...(d.rewriteKind === 'product' ? { rewriteKind: 'product' as const, ...(readProductPlan(d.productPlan) ? { productPlan: readProductPlan(d.productPlan) } : {}) } : {}),
      ...(d.productAutoPosition && typeof d.productAutoPosition === 'object' &&
        Number.isFinite((d.productAutoPosition as { x: number }).x) && Number.isFinite((d.productAutoPosition as { y: number }).y)
        ? { productAutoPosition: { ...(d.productAutoPosition as { x: number; y: number }) } } : {}),
      ...(readRewritePlan(d.rewritePlan) ? { rewritePlan: readRewritePlan(d.rewritePlan) } : {}),
      ...(typeof d.rewriteUserText === 'string' ? { rewriteUserText: d.rewriteUserText } : {}),
      ...(Array.isArray(d.rewriteWarnings) ? { rewriteWarnings: d.rewriteWarnings.filter((value): value is string => typeof value === 'string') } : {}),
      ...(readRewriteStatus(d.rewriteStatus) ? { rewriteStatus: readRewriteStatus(d.rewriteStatus) } : {}),
      ...(Array.isArray(d.rewriteChangeSeconds) ? { rewriteChangeSeconds: readRewriteChangeSeconds(d.rewriteChangeSeconds, readRef(d.rewriteSource)?.seconds ?? Number(input.duration)) } : {}),
      ...(typeof d.rewriteSourceId === 'string' ? { rewriteSourceId: d.rewriteSourceId } : {}), video: { ...normalizeVideoSettings({
      model: typeof input.model === "string" ? input.model : undefined,
      mode: typeof input.mode === "string" ? input.mode : undefined,
      ratio: typeof input.ratio === "string" ? input.ratio : undefined,
      resolution: typeof input.resolution === "string" ? input.resolution : undefined,
      duration: typeof input.duration === "number" ? input.duration : undefined,
      audio: typeof input.audio === "boolean" ? input.audio : undefined
    }), count: settings.count === 2 || settings.count === 4 ? settings.count : 1 },
      ...(readRef(d.rewriteSource)?.media === 'video' ? { rewriteSource: readRef(d.rewriteSource)! } : {}) };
  }
  return { ...common, kind: "image", gen: normalizeGen(d.gen),
    ...(readProductRole(d.productRole) ? { productRole: readProductRole(d.productRole) } : {}),
    ...(typeof d.rewriteId === "string" ? { rewriteId: d.rewriteId } : {}),
    ...(typeof d.rewriteItemId === "string" ? { rewriteItemId: d.rewriteItemId } : {}),
    ...(readRewriteItem(d.rewriteItem) ? { rewriteItem: readRewriteItem(d.rewriteItem) } : {}),
    ...(d.rewriteNewScene === true ? { rewriteNewScene: true as const } : {}),
    ...(typeof d.rewriteSceneId === "string" ? { rewriteSceneId: d.rewriteSceneId } : {}),
    ...(d.rewriteTextOn === true ? { rewriteTextOn: true } : {}),
    ...(typeof d.rewriteSceneText === "string" ? { rewriteSceneText: d.rewriteSceneText.slice(0, MAX_SCENE_TEXT) } : {}),
    ...(typeof d.emptyAspect === "number" && d.emptyAspect >= 0.1 && d.emptyAspect <= 10 ? { emptyAspect: d.emptyAspect } : {}),
    ...(source !== "generate" && typeof d.assetId === "string" && validAssetId(d.assetId) ? { assetId: d.assetId } : {}) };
}

export function fromDoc(doc: CanvasDoc): { meta: CanvasMeta; nodes: CardNode[]; edges: Edge[] } {
  const nodes: CardNode[] = [];
  const oldNodes = (Array.isArray(doc.nodes) ? doc.nodes : []) as unknown[];
  for (const item of oldNodes) {
    const raw = (item ?? {}) as { id?: unknown; x?: unknown; y?: unknown; data?: unknown };
    const data = readCard(raw.data);
    if (!data || typeof raw.id !== "string") continue;
    nodes.push({ id: raw.id, type: "card", position: { x: Number(raw.x) || 0, y: Number(raw.y) || 0 }, data });
  }
  const ids = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = [];
  for (const item of (Array.isArray(doc.edges) ? doc.edges : []) as unknown[]) {
    const e = (item ?? {}) as { id?: unknown; source?: unknown; target?: unknown };
    if (typeof e.source !== "string" || typeof e.target !== "string" || !ids.has(e.source) || !ids.has(e.target)) continue;
    edges.push({ id: typeof e.id === "string" ? e.id : linkId(e.source, e.target), source: e.source, target: e.target });
  }
  return { meta: { id: doc.id, name: doc.name || "未命名画布" }, nodes, edges };
}
