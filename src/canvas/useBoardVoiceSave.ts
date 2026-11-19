import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import type { Notify } from '@/common/Toast';
import type { AssetRef, CardNode } from '@/types';
import type { CharacterView } from '@/characterTypes';
import { voiceDescProblem, voiceSaveSource } from '@/domain/voiceCard';
import { bumpWorks } from '@/library/worksEvents';

/** 11-19 第二期：声音卡右键「存为人物的声音」——选人物、写一句嗓音描述，存进人物库（设计第 8 节）。 */
export function useBoardVoiceSave(notify: Notify, selectedNodes: () => CardNode[]) {
  const [source, setSource] = useState<AssetRef | null>(null);
  const [characters, setCharacters] = useState<CharacterView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true), locked = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const close = () => { setSource(null); setCharacters(null); setError(null); };
  const open = async () => {
    const selected = selectedNodes();
    const picked = voiceSaveSource(selected.length === 1 ? selected[0] : undefined);
    if ('problem' in picked) { notify(picked.problem); return; }
    setSource(picked.ref); setCharacters(null); setError(null);
    try {
      const list = await api.listCharacters();
      if (alive.current) setCharacters(list.filter(character => character.status === 'ready'));
    } catch (reason) { if (alive.current) setError((reason as Error).message); }
  };
  const save = async (characterId: string, desc: string) => {
    if (!source || locked.current) return;
    const problem = voiceDescProblem(desc);
    if (problem) { setError(problem); return; }
    locked.current = true; setBusy(true); setError(null);
    try {
      const character = await api.patchCharacter({ id: characterId, voice: { workId: source.id, desc: desc.trim() } });
      if (alive.current) { close(); notify(`已存为「${character.name}」的声音`); bumpWorks(); }
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  };
  return { source, characters, busy, error, open: () => void open(), close, save,
    canOpen: () => { const selected = selectedNodes(); return selected.length === 1 && selected[0].data.kind === 'audio'; } };
}
