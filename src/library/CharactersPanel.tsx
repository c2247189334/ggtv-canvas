import { useEffect, useRef, useState } from 'react';
import { api } from '@/api';
import { Confirm } from '@/common/Confirm';
import type { Notify } from '@/common/Toast';
import type { CharacterView } from '@/characterTypes';
import { characterDeleteText } from '@/domain/characters';
import { CharacterCard } from './CharacterCard';
import { CharacterDetailDialog, NewCharacterDialog } from './CharacterDialogs';
import { requestCharacterAdd } from './characterEvents';
import { bumpWorks } from './worksEvents';

type Props = {
  characters: CharacterView[] | null; error: string | null; notify: Notify;
  onUpdate: (character: CharacterView) => void; onRemove: (id: string) => void;
};

export function CharactersPanel({ characters, error, notify, onUpdate, onRemove }: Props) {
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CharacterView | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const locked = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const selected = characters?.find(character => character.id === selectedId);

  const mutate = async <T,>(request: () => Promise<T>, success: (result: T) => void) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setActionError(null);
    try {
      const result = await request();
      if (alive.current) { success(result); bumpWorks(); }
    } catch (reason) {
      if (alive.current) setActionError((reason as Error).message);
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  };

  return <div className="characters-panel" onKeyDown={event => {
    if (event.key !== 'Escape' && event.target instanceof Element && event.target.closest('[role="dialog"]')) event.stopPropagation();
  }}>
    <button type="button" className="characters-panel__create" onClick={() => { setCreating(true); setActionError(null); }}>创建新人物</button>
    {error ? <p className="works__error">{error}</p> : null}
    {actionError && !creating && !selected ? <p className="works__error" role="alert">{actionError}</p> : null}
    {characters === null ? <p className="works__empty">读取中…</p> : !characters.length ? <p className="works__empty">还没有人物。</p> : null}
    <div className="characters-panel__list">
      {characters?.map(character => <CharacterCard key={character.id} character={character} busy={busy}
        onOpen={() => { setSelectedId(character.id); setActionError(null); }}
        onRetry={() => void mutate(() => api.generateCharacter({ id: character.id, description: character.description }), onUpdate)}
        onDelete={() => setDeleting(character)} />)}
    </div>
    {creating ? <NewCharacterDialog busy={busy} error={actionError} onClose={() => setCreating(false)}
      onSubmit={description => void mutate(() => api.generateCharacter({ description }), character => { onUpdate(character); setCreating(false); })} /> : null}
    {selected ? <CharacterDetailDialog key={selected.id} character={selected} busy={busy} error={actionError}
      onClose={() => setSelectedId(null)}
      onSave={(name, description) => void mutate(() => api.patchCharacter({ id: selected.id, name, description }), onUpdate)}
      onAdd={() => {
        if (requestCharacterAdd(selected)) setSelectedId(null);
        else notify('画布还没打开，等一下再添加。');
      }} onDelete={() => setDeleting(selected)} /> : null}
    {deleting ? <Confirm text={characterDeleteText(deleting.name)} okLabel="删除" onCancel={() => setDeleting(null)} onOk={() => {
      const id = deleting.id; setDeleting(null);
      void mutate(() => api.deleteCharacter(id), () => { onRemove(id); if (selectedId === id) setSelectedId(null); });
    }} /> : null}
  </div>;
}
