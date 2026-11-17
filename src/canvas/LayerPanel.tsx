import { useState } from 'react';
import { fitLayer, reorder, type EditLayer, type LayerSourceCard, type Order } from '@/domain/layers';
import { REDRAW_TEXT } from '@/domain/layerRedraw';
import { LayerRedrawBox } from './LayerRedrawBox';

type Props = {
  layers: EditLayer[];
  size: { width: number; height: number };
  selected: string | null;
  onSelect: (key: string | null) => void;
  commit: (layers: EditLayer[]) => void;
  change: (key: string, patch: Partial<EditLayer>) => void;
  sources: LayerSourceCard[];
  onAdd: (source: LayerSourceCard, index: number) => void;
  layerUrl: (work: string) => string;
  /** 正在重绘的那层作品编号（没有就是 null）。 */
  redrawing: string | null;
  onRedraw: (layer: EditLayer, text: string) => Promise<void>;
};

const ORDERS: Array<[Order, string]> = [['up', '上移'], ['down', '下移'], ['top', '置于顶层'], ['bottom', '置于底层']];

/**
 * 图层编辑界面右边：图层清单（上面的盖在上面，背景在最下、锁定）+ 选中那层能做的事 + 「添加图层」。
 * 「添加图层」是用户 11-16 要的：把画布上别的卡拆出来的图层（比如另一只鞋的标）加到这张图上来摆。
 */
export function LayerPanel({ layers, size, selected, onSelect, commit, change, sources, onAdd, layerUrl, redrawing, onRedraw }: Props) {
  const [adding, setAdding] = useState(false);
  const layer = layers.find(item => item.key === selected) ?? null;

  return (
    <aside className="layer-panel">
      <div className="layer-panel__head">
        <span>图层</span>
        <button type="button" className="layer-panel__add" onClick={() => setAdding(open => !open)} aria-expanded={adding}>添加图层 ▾</button>
      </div>
      {adding ? (
        <div className="layer-panel__sources">
          {sources.length ? sources.map(source => (
            <div key={source.cardId} className="layer-panel__source">
              <div className="layer-panel__source-name" title={source.title}>{source.title}</div>
              <div className="layer-panel__thumbs">
                {source.split.items.map((item, index) => (
                  <button key={item.work} type="button" title={`加上「${item.name}」`} onClick={() => { onAdd(source, index); setAdding(false); }}>
                    <img src={layerUrl(item.work)} alt={item.name} />
                  </button>
                ))}
              </div>
            </div>
          )) : <p className="layer-panel__empty">画布上别的图还没拆过图层。先在那张图上点「图层分离」，拆好后这里就能选。</p>}
        </div>
      ) : null}
      <ol className="layer-panel__list">
        {[...layers].reverse().map(item => (
          <li key={item.key} className={item.key === selected ? 'is-selected' : ''}>
            <button type="button" className="layer-panel__name" onClick={() => onSelect(item.key)} title={item.from ? `${item.name}（来自 ${item.from}）` : item.name}>
              <img src={layerUrl(item.work)} alt="" />
              <span>{item.name}{item.work === redrawing ? <small>{REDRAW_TEXT.busy}…</small> : item.from ? <small>来自 {item.from}</small> : null}</span>
            </button>
            <button type="button" className="layer-panel__eye" aria-label={item.hidden ? '显示' : '隐藏'} title={item.hidden ? '显示' : '隐藏'}
              onClick={() => change(item.key, { hidden: !item.hidden })}>{item.hidden ? '显示' : '隐藏'}</button>
          </li>
        ))}
        <li className="layer-panel__locked"><span>背景</span><small>已锁定</small></li>
      </ol>
      {layer ? (
        <div className="layer-panel__actions">
          <div className="layer-panel__title">{layer.name}</div>
          <div className="layer-panel__row">
            <button type="button" onClick={() => change(layer.key, { flipX: !layer.flipX })}>水平翻转</button>
            <button type="button" onClick={() => change(layer.key, { flipY: !layer.flipY })}>垂直翻转</button>
            <button type="button" onClick={() => change(layer.key, fitLayer(layer, size.width, size.height))}>适配画布</button>
          </div>
          <div className="layer-panel__row">
            {ORDERS.map(([order, label]) => <button key={order} type="button" onClick={() => commit(reorder(layers, layer.key, order))}>{label}</button>)}
          </div>
          <label className="layer-panel__angle">
            角度
            <input type="number" step={1} value={Math.round(layer.rotation)}
              onChange={event => Number.isFinite(Number(event.target.value)) && change(layer.key, { rotation: Number(event.target.value) })} />
            度
          </label>
          <LayerRedrawBox key={layer.key} layer={layer} busy={redrawing !== null} onRedraw={onRedraw} />
          {layer.from ? <button type="button" className="layer-panel__remove" onClick={() => { commit(layers.filter(item => item.key !== layer.key)); onSelect(null); }}>
            删掉这层</button> : null}
        </div>
      ) : <p className="layer-panel__empty">点图上的东西或清单里的一层来调整。</p>}
    </aside>
  );
}
