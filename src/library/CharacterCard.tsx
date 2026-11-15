import { assetUrl } from '@/domain/cards';
import { characterVideoText } from '@/domain/characters';
import type { CharacterView } from '@/characterTypes';
import { CHARACTER_DRAG_TYPE } from './characterEvents';

type Props = { character: CharacterView; busy: boolean; onOpen: () => void; onRetry: () => void; onDelete: () => void };

export function CharacterCard({ character, busy, onOpen, onRetry, onDelete }: Props) {
  const first = character.images[0];
  const draggable = character.status === 'ready' && Boolean(first);
  return <article className="character-card" role="button" tabIndex={0} aria-label={`查看人物 ${character.name}`}
    draggable={draggable} onClick={onOpen} onKeyDown={event => {
      if (event.target === event.currentTarget && event.key === 'Enter') onOpen();
    }} onDragStart={event => {
      if (!draggable) { event.preventDefault(); return; }
      event.dataTransfer.setData(CHARACTER_DRAG_TYPE, JSON.stringify({ id: character.id }));
      event.dataTransfer.effectAllowed = 'copy';
    }}>
    <div className={`character-card__image${first ? ' has-image' : ''}`}>
      {first ? <img src={assetUrl(first.ref)} alt={character.name} draggable={false} /> : null}
      {character.status === 'generating' ? <span>生成中…</span> : !first ? <span>还没有图片</span> : null}
    </div>
    <strong>{character.name}</strong>
    <span className="character-card__count">{character.images.length} 张图</span>
    {first ? <p className="character-card__video">{characterVideoText(first.video)}</p> : null}
    {character.status === 'failed' ? <>
      <p className="works__error">{character.error}</p>
      <div className="character-card__actions">
        <button type="button" disabled={busy} onClick={event => { event.stopPropagation(); onRetry(); }}>重新生成</button>
        <button type="button" disabled={busy} onClick={event => { event.stopPropagation(); onDelete(); }}>删除</button>
      </div>
    </> : null}
  </article>;
}
