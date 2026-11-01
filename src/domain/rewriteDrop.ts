import type { AssetRef, CardNode, ImageCardData } from '@/types';
import { readWorkDrag, WORK_IMAGE_DRAG_TYPE } from './media';

export type DropPayload = { work: string; files: File[] };
export type RewriteDropPlan = { kind: 'new' } | { kind: 'reject'; message: string }
  | { kind: 'work'; id: string; asset: AssetRef } | { kind: 'file'; id: string; file: File };
const IMAGE_ONLY = '这张卡只能放图片（PNG、JPG、WebP）。';
export const isImageFile = (file: { type: string }) => /^image\/(png|jpeg|webp)$/.test(file.type);

export function rewriteDropTarget(nodes: readonly CardNode[], id: string | null): (CardNode & { data: ImageCardData }) | null {
  const node = nodes.find(candidate => candidate.id === id);
  return node?.data.kind === 'image' && node.data.rewriteId ? node as CardNode & { data: ImageCardData } : null;
}

/** 目标只按鼠标命中的卡判断，不要求选中；被拒绝的改写卡不得退回新建。 */
export function rewriteDropPlan(nodes: readonly CardNode[], id: string | null, payload: DropPayload): RewriteDropPlan {
  const node = rewriteDropTarget(nodes, id);
  if (!node) return { kind: 'new' };
  if (node.data.jobs.length) return { kind: 'reject', message: '这张卡正在生成，请等生成结束后再放图片。' };
  if (payload.work) {
    const asset = readWorkDrag(payload.work);
    return asset && !asset.media ? { kind: 'work', id: node.id, asset } : { kind: 'reject', message: IMAGE_ONLY };
  }
  const file = payload.files[0];
  return file && isImageFile(file) ? { kind: 'file', id: node.id, file } : { kind: 'reject', message: IMAGE_ONLY };
}

export const rewriteImagePatch = (data: ImageCardData, asset: AssetRef) =>
  ({ results: [...data.results, asset], page: data.results.length, note: null });

export function rewriteDropHighlight(nodes: readonly CardNode[], id: string | null,
  preview: { types: readonly string[]; items: readonly { kind: string; type: string }[] }): string | null {
  const target = rewriteDropTarget(nodes, id);
  if (!target || target.data.jobs.length) return null;
  const image = preview.types.includes(WORK_IMAGE_DRAG_TYPE)
    || isImageFile(preview.items.find(item => item.kind === 'file') ?? { type: '' });
  return image ? target.id : null;
}
