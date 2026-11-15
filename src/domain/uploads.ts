// 「我上传的」纯逻辑：转成卡片素材、拖动数据、删除确认原话、占用大小、按画布筛选。
import type { CharacterView } from '@/characterTypes';
import type { AssetRef } from '@/types';
import type { PickedMedia, UploadView } from '@/uploadTypes';
import { workRef } from './media';

/** 当成画布素材用：还是上传素材（type upload），视频带时长和宽高。 */
export function uploadRef(upload: UploadView): AssetRef & { fileName: string } {
  return { type: 'upload', id: upload.id, fileName: upload.name, ...(upload.kind === 'video' ? {
    media: 'video' as const, ...(upload.duration != null ? { seconds: upload.duration } : {}),
    ...(upload.width && upload.height ? { width: upload.width, height: upload.height } : {}),
    ...(typeof upload.hasAudio === 'boolean' ? { hasAudio: upload.hasAudio } : {}), ...(upload.fps !== undefined ? { fps: upload.fps } : {})
  } : {}) };
}

/** 弹窗选中的东西放上画布：来源（上传卡 / 作品卡）、素材、类型。 */
export function pickedAsset(picked: PickedMedia): { source: 'upload' | 'work'; ref: AssetRef & { fileName?: string }; kind: 'image' | 'video' | 'audio' } {
  return picked.source === 'upload' ? { source: 'upload', ref: uploadRef(picked.upload), kind: picked.upload.kind }
    : { source: 'work', ref: workRef(picked.work), kind: picked.work.kind };
}

/** 拖进画布的数据：和作品同一个类型标记，多带 from / name，画布据此建上传卡、用原文件名当标题。 */
export function uploadDragData(upload: UploadView): string {
  const { id, kind, name, duration, width, height, hasAudio, fps } = upload;
  return JSON.stringify({ from: 'upload', id, kind, name, duration, width, height, ...(kind === 'video' ? { hasAudio, fps } : {}) });
}

export function uploadDeleteText(upload: Pick<UploadView, 'id' | 'kind'>, characters: readonly CharacterView[]): string {
  const base = `删掉这个上传的素材？硬盘上的文件会一起删掉，画布上用到它的卡片会显示「${upload.kind === 'video' ? '这段视频' : '这张图'}找不到了」。`;
  const owners = characters.filter(character => character.images.some(image => image.ref.type === 'upload' && image.ref.id === upload.id));
  return base + owners.map(character => `它是人物「${character.name}」的图，人物里也会少这张。`).join('');
}

/** 「共 3 个 · 占 1.2 GB」。 */
export function uploadsSummary(count: number, bytes: number): string {
  const units: Array<[number, string]> = [[1024 ** 3, 'GB'], [1024 ** 2, 'MB'], [1024, 'KB']];
  const [size, unit] = units.find(([step]) => bytes >= step) ?? [1, 'B'];
  const value = bytes / size;
  return `共 ${count} 个 · 占 ${unit === 'B' ? bytes : value >= 10 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function filterUploads(items: readonly UploadView[], canvasId: string | null): UploadView[] {
  return canvasId ? items.filter(item => item.canvases.includes(canvasId)) : [...items];
}
