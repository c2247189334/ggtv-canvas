import { useEffect, useState } from 'react';
import { api } from '@/api';
import type { CharacterView } from '@/characterTypes';
import type { MediaWorkView } from '@/types';

/** 作品与人物一起刷新，各自显示错误，保留上次成功读到的内容。 */
export function useLibraryData(version: number) {
  const [works, setWorks] = useState<MediaWorkView[] | null>(null);
  const [characters, setCharacters] = useState<CharacterView[] | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [characterError, setCharacterError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true, loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const [workResult, characterResult] = await Promise.allSettled([api.listMediaWorks(), api.listCharacters()]);
        if (!alive) return;
        if (workResult.status === 'fulfilled') {
          setWorks(current => JSON.stringify(current) === JSON.stringify(workResult.value) ? current : workResult.value);
          setWorkError(null);
        } else setWorkError((workResult.reason as Error).message);
        if (characterResult.status === 'fulfilled') {
          setCharacters(current => JSON.stringify(current) === JSON.stringify(characterResult.value) ? current : characterResult.value);
          setCharacterError(null);
        } else setCharacterError((characterResult.reason as Error).message);
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [version]);
  return {
    works, characters, workError, characterError,
    updateCharacter: (character: CharacterView) => setCharacters(current => {
      const items = current ?? [];
      return items.some(item => item.id === character.id) ? items.map(item => item.id === character.id ? character : item) : [character, ...items];
    }),
    removeCharacter: (id: string) => setCharacters(current => current?.filter(character => character.id !== id) ?? null)
  };
}
