import type { MouseEvent, PointerEvent } from 'react';
import { ViewportPortal, useKeyPress, useStore } from '@xyflow/react';
import { groupBounds, groupsIn, type GroupLayout } from '@/domain/groups';
import { productSameAsState } from '@/domain/productRemake';
import type { CardNode } from '@/types';
import { fitGroupTools } from './fitGroupTools';

type Props = {
  nodes: CardNode[];
  selected: string | null;
  onPointerDown: (event: PointerEvent, id: string) => void;
  onContextMenu: (event: MouseEvent, id: string) => void;
  onUngroup: () => void;
  onArrange?: (groupId: string, layout: GroupLayout) => void;
  onAddImage?: (groupId: string) => void;
  onAddGroup?: (videoId: string) => void;
  onSameAs?: (groupId: string, target: string | null) => void;
};

const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
const LAYOUTS: Array<[GroupLayout, string]> = [['grid', '宫格排列'], ['horizontal', '水平排列'], ['vertical', '垂直排列']];
const close = (event: { currentTarget: Element }) => event.currentTarget.closest('details')?.removeAttribute('open');

/** 组名和工具条屏幕上大小固定（按 1/缩放 反向放大），缩小画布也看得清（11-04 晚）。 */
export function GroupFrames({ nodes, selected, onPointerDown, onContextMenu, onUngroup, onArrange, onAddImage, onAddGroup, onSameAs }: Props) {
  const panning = useKeyPress('Space');
  const zoom = useStore(state => state.transform[2]);
  const frames = groupsIn(nodes).map(group => {
    const bounds = groupBounds(nodes, group.id)!;
    const active = selected === group.id;
    return <div key={group.id} data-group-id={group.id}
      className={`group-frame nodrag${active ? ' is-selected' : ''}`}
      style={{ transform: `translate(${bounds.x}px, ${bounds.y}px)`, width: bounds.width, height: bounds.height }}
      onPointerDown={event => { if (event.button === 0 && !panning) onPointerDown(event, group.id); }}
      onMouseDown={event => { if (event.button === 0 && !panning) event.stopPropagation(); }}
      onClick={stop} onDoubleClick={stop}
      onContextMenu={event => onContextMenu(event, group.id)}>
      <span className="group-frame__name" style={{ transform: `scale(${1 / zoom})` }}>{group.name}</span>
      {active ? ['tl', 'tr', 'bl', 'br'].map(corner => <span key={corner} className={`group-frame__corner ${corner}`} />) : null}
    </div>;
  });
  // 工具条单独放、不进组框：组框 z-index -1 会把里面的东西一起压在卡片下面，旁边的卡一盖就点不到（11-03 验收）。
  const bounds = selected ? groupBounds(nodes, selected) : null;
  const group = nodes.find(n => n.data.group?.id === selected)?.data.group;
  const product = group?.productId && group.videoId ? group : null;
  const same = selected && product ? productSameAsState(nodes, selected) : null;
  // 贴屏幕边、钻进四角按钮栏时 fitGroupTools 挪回来（11-09）；换组换 key 重挂。
  const tools = bounds && selected ? <div key={`group-tools-${selected}`} ref={fitGroupTools} data-tools-for={selected} className="card-tools group-frame__tools nodrag"
    style={{ transform: `translate(${bounds.x + bounds.width / 2}px, ${bounds.y}px) scale(${1 / zoom}) translate(-50%, calc(-100% - 34px))` }}
    onPointerDown={stop} onMouseDown={stop} onClick={stop} onDoubleClick={stop}>
    {onArrange ? <details key={selected} className="group-frame__arrange">
      <summary className="card-tools__button">排列 ▾</summary>
      <span className="group-frame__menu" role="menu">
        {LAYOUTS.map(([layout, label]) => <button key={layout} type="button" role="menuitem" className="card-tools__button"
          onClick={event => { close(event); onArrange(selected, layout); }}>{label}</button>)}
      </span>
    </details> : null}
    {product && onAddImage ? <button type="button" className="card-tools__button" disabled={Boolean(same?.current)}
      title={same?.current ? `这组跟商品${same.current}一样，要传自己的图先点「不跟了」` : undefined} onClick={() => onAddImage(selected)}>加一张</button> : null}
    {product && onAddGroup ? <button type="button" className="card-tools__button" onClick={() => onAddGroup(product.videoId!)}>再加一组</button> : null}
    {same && onSameAs ? (!same.current && same.hasImage
      ? <button type="button" className="card-tools__button" disabled title="这组已经有图了，会按自己的图换">跟哪组一样 ▾</button>
      : <details key={`same-${selected}`} className="group-frame__arrange">
        <summary className={`card-tools__button${same.current ? ' is-on' : ''}`} title="和别的组同款同色时选它，这组不用传图">
          {same.current ? `✓ 跟商品${same.current}一样 ▾` : '跟哪组一样 ▾'}</summary>
        <span className="group-frame__menu" role="menu">
          {same.options.map(option => <button key={option.id} type="button" role="menuitem" className="card-tools__button"
            aria-checked={same.current === option.id} onClick={event => { close(event); onSameAs(selected, option.id); }}>跟{option.label}一样</button>)}
          {same.current ? <button type="button" role="menuitem" className="card-tools__button"
            onClick={event => { close(event); onSameAs(selected, null); }}>不跟了，自己传图</button> : null}
        </span>
      </details>) : null}
    <button type="button" className="card-tools__button" onClick={() => onUngroup()}>解组</button>
  </div> : null;
  return <ViewportPortal>{tools ? [...frames, tools] : frames}</ViewportPortal>;
}
