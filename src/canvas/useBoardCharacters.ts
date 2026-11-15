import { useEffect, useRef, useState } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import type { Notify } from '@/common/Toast';
import type { CardNode } from '@/types';
import type { CharacterSaveImage, CharacterView } from '@/characterTypes';
import type { CharacterSaveFields } from '@/library/SaveCharacterDialog';
import { characterCenteredStart, characterDropId, characterNodes, characterSaveImages, characterSaveProblem } from '@/domain/characterCanvas';
import { rewriteCharacterDrop, rewriteImagePatch } from '@/domain/rewriteDrop';
import type { Point } from '@/domain/placement';
import { currentResult } from '@/domain/cards';
import { bumpWorks, isWorkDeleted } from '@/library/worksEvents';
import { subscribeCharacterAdd } from '@/library/characterEvents';
import type { useBoardDoc } from './useBoardDoc';

export function useBoardCharacters(doc: ReturnType<typeof useBoardDoc>, notify: Notify, selectedNodes: () => CardNode[], clearGroup: () => void) {
  const flow = useReactFlow<CardNode, Edge>();
  const [images, setImages] = useState<CharacterSaveImage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true), locked = useRef(false);
  const receive = useRef<(character: CharacterView) => void>(() => {});
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const selectedImages = () => {
    const selected = selectedNodes();
    const deleted = new Set(selected.flatMap(node => {
      const ref = currentResult(node.data);
      return ref?.type === 'work' && isWorkDeleted(ref.id) ? [ref.id] : [];
    }));
    return characterSaveImages(selected, deleted);
  };
  const add = (character: CharacterView, at?: Point) => {
    if (!doc.ready) { notify('画布还没打开，等一下再添加。'); return; }
    let start = at;
    if (!start) {
      const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
      if (!bounds) return;
      const center = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 });
      start = characterCenteredStart(character.images.length, center);
    }
    const nodes = characterNodes(character, start);
    if (!nodes.length) { notify('人物还没有可添加的图片。'); return; }
    clearGroup();
    doc.setNodes(current => [...current.map(node => node.selected ? { ...node, selected: false } : node), ...nodes]);
    doc.setEdges(current => current.map(edge => edge.selected ? { ...edge, selected: false } : edge));
  };
  receive.current = character => add(character);
  useEffect(() => subscribeCharacterAdd(character => receive.current(character)), []);

  const save = async (fields: CharacterSaveFields) => {
    if (!images || locked.current) return;
    const input = { ...fields, images };
    const problem = characterSaveProblem(input);
    if (problem) { setError(problem); return; }
    locked.current = true; setBusy(true); setError(null);
    try {
      const character = await api.saveCharacter(input);
      if (alive.current) { setImages(null); notify(`已存进人物库：${character.name}`); bumpWorks(); }
    } catch (reason) {
      if (alive.current) setError((reason as Error).message);
    } finally { locked.current = false; if (alive.current) setBusy(false); }
  };

  return {
    images, busy, error, save,
    canSave: () => selectedImages() !== null,
    openSave: () => {
      const selected = selectedImages();
      if (!selected) { notify('选 1～8 张有结果的图片卡才能存为人物。'); return; }
      setImages(selected); setError(null);
    },
    closeSave: () => { setImages(null); setError(null); },
    drop: async (raw: string, at: Point, targetId: string | null = null) => {
      const id = characterDropId(raw);
      if (!id) { notify('人物拖入信息不完整，请重新拖一次。'); return; }
      try {
        const list = await api.listCharacters();
        if (!alive.current) return;
        const character = list.find(item => item.id === id);
        if (!character) { notify('人物已经不在了。'); return; }
        const plan = rewriteCharacterDrop(flow.getNodes(), targetId, character);
        if (plan.kind === 'reject') { notify(plan.message); return; }
        if (plan.kind === 'new') { add(character, at); return; }
        doc.setNodes(current => current.map(node => node.id === plan.id && node.data.kind === 'image'
          ? { ...node, data: { ...node.data, ...rewriteImagePatch(node.data, plan.asset) } } : node));
        if (plan.lostAsset) notify(`「${character.name}」的真人素材编号没带过来：改写图片卡不支持素材编号，交视频时这张图可能被火山拦下。`);
      } catch (reason) { if (alive.current) notify((reason as Error).message); }
    }
  };
}
