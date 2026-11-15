import type { CharacterSaveImage, CharacterSaveInput, CharacterView } from '@/characterTypes';
import type { CardNode } from '@/types';
import { currentResult, newCard } from './cards';
import { characterFieldsProblem } from './characters';
import { CARD_HEIGHT, CARD_WIDTH, type Point } from './placement';
import { validAssetId } from './videoPanel';

export function characterSaveImages(nodes: readonly CardNode[], deletedWorks: ReadonlySet<string> = new Set()): CharacterSaveImage[] | null {
  if (!nodes.length || nodes.length > 8) return null;
  const images: CharacterSaveImage[] = [];
  for (const node of nodes) {
    const ref = currentResult(node.data);
    if (node.data.kind !== 'image' || !ref || ref.media || ref.type === 'work' && deletedWorks.has(ref.id)) return null;
    const assetId = node.data.assetId;
    images.push({ type: ref.type, id: ref.id, ...(assetId && validAssetId(assetId) ? { assetId } : {}) });
  }
  return images;
}

export function characterSaveProblem(input: CharacterSaveInput): string | null {
  const problem = characterFieldsProblem(input.name, input.description);
  if (problem) return problem;
  if (input.images.length < 1 || input.images.length > 8) return '选 1～8 张有结果的图片卡才能存为人物。';
  if (input.images.some(image => image.type === 'upload') && input.authorized !== true) return '先勾选授权';
  return null;
}

export function characterNodes(character: CharacterView, at: Point, newId = () => `card-${crypto.randomUUID().slice(0, 8)}`): CardNode[] {
  if (character.status !== 'ready') return [];
  // 11-06 用户定：只有一张图的人物就是一张普通图片卡，多张才成组一起拖。
  const group = character.images.length > 1 ? { id: `group-${crypto.randomUUID()}`, name: character.name, characterId: character.id } : undefined;
  return character.images.map((image, index) => ({
    id: newId(), type: 'card', selected: true,
    position: { x: at.x + index * (CARD_WIDTH + 24), y: at.y },
    data: { ...newCard(image.ref.type, 0, [{ ...image.ref }]), title: `${character.name} · ${image.label}`, ...(group ? { group } : {}),
      ...(image.assetId ? { assetId: image.assetId } : {}) }
  }));
}

export function characterCenteredStart(count: number, center: Point): Point {
  const width = count * CARD_WIDTH + Math.max(0, count - 1) * 24;
  return { x: center.x - width / 2, y: center.y - CARD_HEIGHT / 2 };
}

export function characterDropId(raw: string): string | null {
  try {
    const value = JSON.parse(raw) as { id?: unknown } | null;
    return value && typeof value.id === 'string' && value.id.trim() ? value.id : null;
  } catch { return null; }
}
