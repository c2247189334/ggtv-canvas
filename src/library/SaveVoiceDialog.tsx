import { useState } from 'react';
import type { AssetRef } from '@/types';
import type { CharacterView } from '@/characterTypes';
import { assetUrl } from '@/domain/cards';
import { durationLabel } from '@/domain/videoPanel';
import { voiceDescProblem } from '@/domain/voiceCard';
import { CharacterDialogShell } from './CharacterDialogs';

type Props = {
  source: AssetRef; characters: CharacterView[] | null; busy: boolean; error: string | null;
  onSave: (characterId: string, desc: string) => void; onClose: () => void;
};

/** 11-19 第二期：声音卡存成人物的声音。人物已有声音时写明会换掉。 */
export function SaveVoiceDialog({ source, characters, busy, error, onSave, onClose }: Props) {
  const [characterId, setCharacterId] = useState('');
  const [desc, setDesc] = useState('');
  const chosen = characters?.find(character => character.id === characterId);
  const problem = !characterId ? '选一个人物。' : voiceDescProblem(desc);
  return <CharacterDialogShell title="存为人物的声音" onClose={onClose}>
    <form className="voice-save" onSubmit={event => { event.preventDefault(); if (!problem && !busy) onSave(characterId, desc); }}>
      <p>这段声音（{durationLabel(source.seconds)}）以后会跟着人物走：把人物拖到「露脸 · AI 自己配音」的人物卡上，会自动连一张声音卡，每段都用同一个音色。</p>
      <audio className="voice-save__audio" controls preload="metadata" src={assetUrl(source)} aria-label="要存的声音" />
      <label>存给谁
        <select aria-label="存给哪个人物" value={characterId} onChange={event => setCharacterId(event.target.value)} disabled={!characters?.length}>
          <option value="">{characters === null ? '读取中…' : characters.length ? '选一个人物' : '人物库里还没有人物'}</option>
          {characters?.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
        </select>
      </label>
      {chosen?.voice ? <p className="works__error">「{chosen.name}」已经有声音了，保存会换掉原来那段。</p> : null}
      <label>嗓音描述（每段都原样用这句）
        <textarea aria-label="嗓音描述" rows={2} maxLength={200} value={desc} placeholder="例如：清亮自然的年轻男声，普通话，语速偏快，语气轻松带笑"
          onChange={event => setDesc(event.target.value)} />
      </label>
      {error ? <p className="works__error" role="alert">{error}</p> : null}
      {characterId && desc.trim() && problem ? <p className="works__error">{problem}</p> : null}
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={busy || Boolean(problem)}>{busy ? '保存中…' : '保存'}</button></footer>
    </form>
  </CharacterDialogShell>;
}
