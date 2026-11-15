import { useState } from 'react';
import type { CharacterSaveImage, CharacterSaveInput } from '@/characterTypes';
import { characterSaveProblem } from '@/domain/characterCanvas';
import { CharacterDialogShell } from './CharacterDialogs';

export type CharacterSaveFields = Omit<CharacterSaveInput, 'images'>;
type Props = {
  images: CharacterSaveImage[]; busy: boolean; error: string | null;
  onSave: (fields: CharacterSaveFields) => void; onClose: () => void;
};
type FormProps = Props & CharacterSaveFields & {
  onName: (name: string) => void; onDescription: (description: string) => void; onAuthorized: (authorized: boolean) => void;
};

export function SaveCharacterForm({ images, name, description, authorized, busy, error, onName, onDescription, onAuthorized, onSave, onClose }: FormProps) {
  const problem = characterSaveProblem({ images, name, description, authorized });
  const needsAuthorization = images.some(image => image.type === 'upload');
  return <form onSubmit={event => {
    event.preventDefault();
    if (!problem && !busy) onSave({ name: name.trim(), description: description.trim(), authorized });
  }}>
    <label>名字<input autoFocus aria-label="人物名字" value={name} maxLength={80} onChange={event => onName(event.target.value)} /></label>
    <label>描述（可选）<textarea aria-label="人物描述" rows={3} value={description} maxLength={1000}
      onChange={event => onDescription(event.target.value)} /></label>
    <p>选中的 {images.length} 张图片会存进人物库。</p>
    {needsAuthorization ? <label className="character-save__authorization">
      <input type="checkbox" checked={authorized} onChange={event => onAuthorized(event.target.checked)} />
      我确认拥有该人物形象的合法使用授权
    </label> : null}
    {error ? <p className="works__error" role="alert">{error}</p> : null}
    {name.trim() && problem ? <p className="works__error">{problem}</p> : null}
    <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={busy || Boolean(problem)}>{busy ? '保存中…' : '保存'}</button></footer>
  </form>;
}

export function SaveCharacterDialog(props: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [authorized, setAuthorized] = useState(false);
  return <CharacterDialogShell title="存为人物" onClose={props.onClose}>
    <SaveCharacterForm {...props} name={name} description={description} authorized={authorized}
      onName={setName} onDescription={setDescription} onAuthorized={setAuthorized} />
  </CharacterDialogShell>;
}
