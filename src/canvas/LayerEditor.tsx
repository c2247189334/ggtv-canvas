import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Confirm } from '@/common/Confirm';
import { useEscapeLayer } from '@/common/useEscapeLayer';
import { assetUrl, cardTitle, currentResult } from '@/domain/cards';
import { importLayer, layerSources, LAYER_TEXT, MAX_SELECTIONS, splitMatches, type Box, type EditLayer, type LayerSourceCard } from '@/domain/layers';
import { swapRedrawn } from '@/domain/layerRedraw';
import type { CardNode, LayerSplit } from '@/types';
import { LayerPanel } from './LayerPanel';
import { LayerStage } from './LayerStage';
import { useLayerEditor } from './useLayerEditor';

const workUrl = (id: string) => assetUrl({ type: 'work', id });

type Props = {
  node: CardNode;
  nodes: CardNode[];
  onClose: () => void;
  split: (cardId: string, text: string, rects: Box[], size: { width: number; height: number }) => Promise<void>;
  merge: (cardId: string, split: LayerSplit, layers: readonly EditLayer[]) => Promise<void>;
  redraw: (cardId: string, layer: EditLayer, text: string) => Promise<void>;
  /** 查到的重绘结果（from → work）：开着界面时把那层换成新图。 */
  redrawn: ReadonlyArray<{ from: string; work: string }>;
};

/**
 * 11-16 图层分离界面（整屏，用户定照参考软件）：
 *  - 还没拆 / 点了「重新分离」：图上框选 + 一句描述，「拆分」交给火山；拆的时候显示「图层分离中」，关掉界面也接着拆。
 *  - 拆好了：背景锁定，图层能挪、缩放、转、翻转、调上下层，还能加别的图拆出来的图层；「合并」本机合成新图放在原卡右边。
 *  没合并就关，问一句「放弃本次图层调整？」；拆好的图层留在卡上，下次点开直接接着摆。
 */
export function LayerEditor({ node, nodes, onClose, split, merge, redraw, redrawn }: Props) {
  const data = node.data.kind === 'image' ? node.data : null;
  const current = data ? currentResult(data) : null;
  const done = splitMatches(data?.layerSplit, current) ? data!.layerSplit : undefined;
  const [resplit, setResplit] = useState(false);
  const mode = done && !resplit ? 'edit' : 'split';
  const editor = useLayerEditor(done);
  const [text, setText] = useState('');
  const [rects, setRects] = useState<Box[]>([]);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | 'resplit' | null>(null);
  const busy = Boolean(data?.layerJob);
  // 卡上的提示也可能是出图失败留下的；这里只显示图层分离自己的（absorbLayerViews 写的那句）。
  const layerNote = data?.note?.startsWith('图层分离没成') || data?.note?.startsWith('图层重绘没成') ? data.note : null;
  const title = data ? cardTitle(data) : '';
  const sources: LayerSourceCard[] = layerSources(nodes, node.id, item => cardTitle(item.data));

  useEffect(() => { setResplit(false); }, [done?.base]);

  // 重绘出好：把送去重绘的那层换成新图（记一步，能撤销）。打开界面前就出好的已经在卡上了，不再换。
  const applied = useRef(new Set(redrawn.map(item => item.work)));
  useEffect(() => {
    for (const item of redrawn) {
      if (applied.current.has(item.work)) continue;
      applied.current.add(item.work);
      const next = swapRedrawn(editor.layers, item.from, item.work);
      if (next) editor.commit(next);
    }
  }, [redrawn, editor]);

  const requestClose = () => {
    if (confirm) return;
    if (mode === 'edit' && editor.changed > 0) setConfirm('discard');
    else onClose();
  };
  useEscapeLayer(requestClose, true, 1150);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (mode !== 'edit' || !(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) { event.preventDefault(); editor.undo(); }
      else if (key === 'y' || (key === 'z' && event.shiftKey)) { event.preventDefault(); editor.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const run = async (job: () => Promise<void>) => {
    setError(null);
    setWorking(true);
    try { await job(); } catch (err) { setError((err as Error).message); } finally { setWorking(false); }
  };
  const submit = () => run(async () => {
    if (!natural) throw new Error('图还没读出来，稍等一下。');
    await split(node.id, text, rects, natural);
    setRects([]);
  });
  const onSplitClick = () => { if (done) setConfirm('resplit'); else void submit(); };
  const onMerge = () => done && run(async () => { await merge(node.id, done, editor.layers); onClose(); });
  const onAdd = (source: LayerSourceCard, index: number) => {
    if (!done) return;
    const layer = importLayer(source, index, done, editor.layers);
    editor.commit([...editor.layers, layer]);
    editor.select(layer.key);
  };

  if (!data || !current) return null;
  return createPortal(
    <div className="layer-editor" role="dialog" aria-modal="true" aria-label={`${title} 图层分离`}>
      <header className="layer-editor__top">
        <div className="layer-editor__name" title={title}>{title} 图层分离</div>
        <div className="layer-editor__hint" title={mode === 'edit' ? LAYER_TEXT.editHint : LAYER_TEXT.splitHint}>{mode === 'edit' ? LAYER_TEXT.editHint : LAYER_TEXT.splitHint}</div>
        {mode === 'edit' ? <div className="layer-editor__history">
          <button type="button" onClick={editor.undo} disabled={!editor.canUndo} title="撤销（Ctrl+Z）">撤销</button>
          <button type="button" onClick={editor.redo} disabled={!editor.canRedo} title="重做（Ctrl+Shift+Z）">重做</button>
        </div> : null}
        <button type="button" className="layer-editor__close" aria-label="关闭" onClick={requestClose}>×</button>
      </header>
      <div className="layer-editor__body">
        <LayerStage mode={mode} url={mode === 'edit' ? workUrl(done!.base) : assetUrl(current)}
          size={mode === 'edit' ? done! : natural} onNatural={mode === 'split' ? setNatural : undefined}
          layers={editor.layers} layerUrl={workUrl} selected={editor.selected} onSelect={editor.select}
          preview={editor.preview} commit={editor.commit} rects={rects} onRects={setRects} />
        {mode === 'edit' ? <LayerPanel layers={editor.layers} size={done!} selected={editor.selected} onSelect={editor.select}
          commit={next => editor.commit(next)} change={editor.change} sources={sources} onAdd={onAdd} layerUrl={workUrl}
          redrawing={data?.layerRedraw?.from ?? null} onRedraw={(layer, words) => redraw(node.id, layer, words)} /> : null}
        {busy ? <div className="layer-editor__busy"><span className="busy-spinner" aria-hidden="true" />{LAYER_TEXT.splitting}…</div> : null}
      </div>
      <footer className="layer-editor__bottom">
        {mode === 'split' ? <>
          <input className="layer-editor__input" value={text} maxLength={500} placeholder={LAYER_TEXT.input}
            onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !busy && !working) onSplitClick(); }} />
          <span className="layer-editor__count">{rects.length ? `已选 ${rects.length} 处` : `可在图上框选，最多 ${MAX_SELECTIONS} 处`}</span>
          {done ? <button type="button" onClick={() => setResplit(false)} disabled={busy}>返回</button> : null}
          <button type="button" className="layer-editor__primary" disabled={busy || working || !natural} onClick={onSplitClick}>拆分</button>
        </> : <>
          <button type="button" onClick={() => { setResplit(true); setRects([]); }} disabled={busy}>重新分离</button>
          <button type="button" className="layer-editor__primary" disabled={working} onClick={() => void onMerge()}>{working ? '合并中…' : '合并'}</button>
        </>}
      </footer>
      {error || (layerNote && !busy) ? <div className="layer-editor__error" role="alert">{error ?? layerNote}</div> : null}
      {confirm === 'discard' ? <Confirm text={`${LAYER_TEXT.discardTitle}${LAYER_TEXT.discard(editor.changed)}`} okLabel="放弃" cancelLabel="继续编辑"
        onOk={() => { setConfirm(null); onClose(); }} onCancel={() => setConfirm(null)} /> : null}
      {confirm === 'resplit' ? <Confirm text={`${LAYER_TEXT.resplitTitle}${LAYER_TEXT.resplit}`} okLabel="重新分离"
        onOk={() => { setConfirm(null); void submit(); }} onCancel={() => setConfirm(null)} /> : null}
    </div>,
    document.body
  );
}
