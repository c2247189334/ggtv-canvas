import type { ProductPlan, ProductRole } from '@/productRemakeTypes';

const object = (v: unknown): Record<string, unknown> | null => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): v is string => typeof v === 'string';
const number = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function readProductRole(raw: unknown): ProductRole | undefined {
  const d = object(raw);
  if (!d || !text(d.videoId) || !d.videoId || (d.role !== 'product' && d.role !== 'background')) return undefined;
  if (d.role === 'product' && (!text(d.productId) || !/^[A-Z]+$/.test(d.productId))) return undefined;
  const sameAs = text(d.sameAs) && /^[A-Z]+$/.test(d.sameAs) && d.sameAs !== d.productId ? d.sameAs : undefined;
  return { videoId: d.videoId, role: d.role, ...(d.role === 'product' ? { productId: d.productId as string, ...(text(d.name) ? { name: d.name } : {}),
    ...(text(d.where) && d.where ? { where: d.where } : {}), ...(sameAs ? { sameAs } : {}) } : {}) };
}
export function readProductPlan(raw: unknown): ProductPlan | undefined {
  const d = object(raw);
  if (!d || !text(d.visible) || typeof d.face !== 'boolean' || !Array.isArray(d.products) || !Array.isArray(d.looks) || !Array.isArray(d.timeline) || !Array.isArray(d.unsure)) return undefined;
  const products = d.products.map(object), looks = d.looks.map(object), timeline = d.timeline.map(object);
  if (products.length > 100 || products.some(p => !p || !text(p.id) || !/^[A-Z]+$/.test(p.id) || !text(p.name) || !text(p.look) || !number(p.pairs) || !number(p.pieces) || !text(p.layout))) return undefined;
  if (new Set(products.map(p => p!.id)).size !== products.length) return undefined;
  if (looks.some(p => !p || !text(p.id) || (p.kind !== 'scene' && p.kind !== 'outfit') || !text(p.what) || !text(p.now) || !text(p.target))) return undefined;
  if (timeline.some(p => !p || !number(p.from) || !number(p.to) || p.to <= p.from || !text(p.action)) || !d.unsure.every(text)) return undefined;
  return structuredClone({ products: products.map(p => ({ id: p!.id, name: p!.name, look: p!.look, pairs: p!.pairs, pieces: p!.pieces, layout: p!.layout, ...(text(p!.where) && p!.where ? { where: p!.where } : {}) })),
    visible: d.visible, face: d.face, looks: looks.map(p => ({ id: p!.id, kind: p!.kind, what: p!.what, now: p!.now, target: p!.target })),
    timeline: timeline.map(p => ({ from: p!.from, to: p!.to, action: p!.action })), unsure: d.unsure }) as ProductPlan;
}
