import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { changedCount, initialLayers, patchLayer, type EditLayer } from '@/domain/layers';
import type { LayerSplit } from '@/types';

const MAX_HISTORY = 50;

/**
 * 图层编辑界面里的排版和撤销 / 重做（只在这个界面里，不进画布的撤销记录）。
 * preview 是拖动途中每帧的样子，不记步；拖完 commit 记一步（和画布「松手记一步」一样）。
 * 换了拆分结果（重新分离后，底图变了）整个重置；图层重绘只换某一层的图，不重置排版（由界面 swap）。
 */
export function useLayerEditor(split: LayerSplit | undefined) {
  const baseKey = split ? `${split.base}:${split.source.id}` : '';
  // 故意只跟底图走（见上）：重绘后 split.items 变了也不重置。
  const initial = useMemo(() => split ? initialLayers(split) : [], [baseKey]);
  const [layers, setLayers] = useState<EditLayer[]>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const past = useRef<EditLayer[][]>([]), future = useRef<EditLayer[][]>([]);
  const [, bump] = useState(0);

  useEffect(() => {
    setLayers(initial);
    setSelected(null);
    past.current = [];
    future.current = [];
  }, [initial]);

  /** 记一步：before 是这一步之前的样子（拖动时是按下那一刻的）。 */
  const commit = useCallback((next: EditLayer[], before: EditLayer[] = layers) => {
    if (JSON.stringify(next) === JSON.stringify(before)) { setLayers(next); return; }
    past.current = [...past.current, before].slice(-MAX_HISTORY);
    future.current = [];
    setLayers(next);
    bump(n => n + 1);
  }, [layers]);

  const change = useCallback((key: string, patch: Partial<EditLayer>) => commit(patchLayer(layers, key, patch)), [commit, layers]);

  const undo = useCallback(() => {
    const previous = past.current.at(-1);
    if (!previous) return;
    past.current = past.current.slice(0, -1);
    future.current = [layers, ...future.current];
    setLayers(previous);
    bump(n => n + 1);
  }, [layers]);

  const redo = useCallback(() => {
    const next = future.current[0];
    if (!next) return;
    future.current = future.current.slice(1);
    past.current = [...past.current, layers];
    setLayers(next);
    bump(n => n + 1);
  }, [layers]);

  return { layers, preview: setLayers, commit, change, undo, redo, selected, select: setSelected,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0, changed: changedCount(initial, layers) };
}
