import { api } from '@/api';
import { workDeleteText } from '@/domain/characters';
import type { MediaWorkView } from '@/types';

/** 确认前重新读人物清单，刚存进去的人物也能得到提醒。 */
export async function loadWorkDeletion(work: MediaWorkView): Promise<{ work: MediaWorkView; text: string }> {
  const characters = await api.listCharacters();
  return { work, text: workDeleteText(work.id, characters) };
}
