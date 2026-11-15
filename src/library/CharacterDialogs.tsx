import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { assetUrl } from '@/domain/cards';
import { characterDescriptionProblem, characterFieldsProblem, characterVideoText } from '@/domain/characters';
import type { CharacterView } from '@/characterTypes';

export function CharacterDialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeLayer(onClose, true, 1250);
  return createPortal(<div className="character-modal" role="dialog" aria-modal="true" aria-label={title}
    onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="character-dialog">
      <header><h2>{title}</h2><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
      {children}
    </section>
  </div>, document.body);
}

type ActionProps = { busy: boolean; error: string | null; onClose: () => void };
export function NewCharacterDialog({ busy, error, onClose, onSubmit }: ActionProps & { onSubmit: (description: string) => void }) {
  const [description, setDescription] = useState('');
  const problem = characterDescriptionProblem(description);
  return <CharacterDialogShell title="创建你的新人物" onClose={onClose}>
    <div className="character-create__blank" aria-hidden="true" />
    <form onSubmit={event => { event.preventDefault(); if (!problem && !busy) onSubmit(description.trim()); }}>
      {error ? <p className="works__error" role="alert">{error}</p> : null}
      <div className="character-create__input">
        <textarea autoFocus placeholder="描述你的人物特征" aria-label="人物描述" rows={2} maxLength={1000}
          value={description} onChange={event => setDescription(event.target.value)} />
        <button type="submit" data-character-send disabled={busy || Boolean(problem)}>{busy ? '发送中…' : '发送'}</button>
      </div>
    </form>
  </CharacterDialogShell>;
}

type DetailProps = ActionProps & { character: CharacterView; onSave: (name: string, description: string) => void; onAdd: () => void; onDelete: () => void };
export function CharacterDetailDialog({ character, busy, error, onClose, onSave, onAdd, onDelete }: DetailProps) {
  const [name, setName] = useState(character.name);
  const [description, setDescription] = useState(character.description);
  const problem = characterFieldsProblem(name, description);
  return <CharacterDialogShell title="人物详情" onClose={onClose}>
    <div className="character-detail__images">
      {character.images.map((image, index) => <figure key={`${image.ref.type}-${image.ref.id}-${index}`}>
        <img src={assetUrl(image.ref)} alt={`${character.name} · ${image.label}`} />
        <figcaption><strong>{image.label}</strong><p>{characterVideoText(image.video)}</p></figcaption>
      </figure>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); if (!problem && !busy) onSave(name.trim(), description.trim()); }}>
      <label>名字<input autoFocus aria-label="人物名字" value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <label>描述<textarea aria-label="人物描述" value={description} rows={3} maxLength={1000} onChange={event => setDescription(event.target.value)} /></label>
      {error ? <p className="works__error" role="alert">{error}</p> : null}
      {problem ? <p className="works__error">{problem}</p> : null}
      <footer>
        <button type="button" disabled={busy} onClick={onDelete}>删除</button>
        <button type="submit" disabled={busy || Boolean(problem)}>保存修改</button>
        <button type="button" disabled={busy || character.status !== 'ready' || !character.images.length} onClick={onAdd}>添加到画布</button>
      </footer>
    </form>
  </CharacterDialogShell>;
}
