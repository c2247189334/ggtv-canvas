import type { CharacterView } from '@/characterTypes';

export const CHARACTER_DRAG_TYPE = 'application/x-canvas-character';
const listeners = new Set<(character: CharacterView) => void>();

export function subscribeCharacterAdd(listener: (character: CharacterView) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestCharacterAdd(character: CharacterView): boolean {
  for (const listener of listeners) listener(character);
  return listeners.size > 0;
}
