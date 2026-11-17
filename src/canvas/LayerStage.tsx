import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { angleOf, MAX_SELECTIONS, patchLayer, scaleLayer, type Box, type EditLayer } from '@/domain/layers';

type Size = { width: number; height: number };
type Drag = { kind: 'move' | 'scale' | 'rotate' | 'box'; key?: string; start: { x: number; y: number }; before: EditLayer[]; layer?: EditLayer };

type Props = {
  mode: 'split' | 'edit';
  url: string;
  /** 底图原尺寸；拆之前还不知道时给 null，等图读出来再回报。 */
  size: Size | null;
  onNatural?: (size: Size) => void;
  layers: EditLayer[];
  layerUrl: (work: string) => string;
  selected: string | null;
  onSelect: (key: string | null) => void;
  preview: (layers: EditLayer[]) => void;
  commit: (layers: EditLayer[], before: EditLayer[]) => void;
  rects: Box[];
  onRects: (rects: Box[]) => void;
};

const MIN_BOX_SCREEN = 6;

/**
 * 图层编辑界面中间那块：底图按比例放满，背景锁定不能动。
 * 拆之前（split）在图上按住拖 = 框选要拆的东西（选区 1、2…，最多 16 处）；
 * 拆好后（edit）点图层选中、拖动挪位置、拖右下角圆点按比例缩放、拖上方圆点转角度（按住 Shift 每 15 度一档）。
 */
export function LayerStage({ mode, url, size, onNatural, layers, layerUrl, selected, onSelect, preview, commit, rects, onRects }: Props) {
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<Size>({ width: 800, height: 600 });
  const drag = useRef<Drag | null>(null);
  const latest = useRef(layers);
  latest.current = layers;

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setRoom({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale = size ? Math.min(room.width / size.width, room.height / size.height) * 0.94 : 0;
  /** 屏幕坐标换成底图像素。 */
  const toImage = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  };

  const begin = (event: ReactPointerEvent, next: Drag) => {
    event.stopPropagation();
    event.preventDefault();
    drag.current = next;
    canvas.current?.setPointerCapture(event.pointerId);
  };

  const onMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !size) return;
    const point = toImage(event);
    if (d.kind === 'box') {
      const last: Box = [d.start.x, d.start.y, point.x, point.y];
      onRects([...rects.slice(0, -1), last]);
      return;
    }
    const layer = d.layer!;
    if (d.kind === 'move') preview(patchLayer(d.before, layer.key, { x: layer.x + point.x - d.start.x, y: layer.y + point.y - d.start.y }));
    if (d.kind === 'scale') {
      const from = Math.hypot(d.start.x - layer.x, d.start.y - layer.y), to = Math.hypot(point.x - layer.x, point.y - layer.y);
      if (from > 0) preview(patchLayer(d.before, layer.key, scaleLayer(layer, to / from)));
    }
    if (d.kind === 'rotate') preview(patchLayer(d.before, layer.key, { rotation: angleOf(layer, point, event.shiftKey) }));
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind !== 'box') { commit(latest.current, d.before); return; }
    const last = rects.at(-1);
    if (last && (Math.abs(last[2] - last[0]) * scale < MIN_BOX_SCREEN || Math.abs(last[3] - last[1]) * scale < MIN_BOX_SCREEN)) onRects(rects.slice(0, -1));
  };

  const startBox = (event: ReactPointerEvent) => {
    if (mode !== 'split') { onSelect(null); return; }
    if (rects.length >= MAX_SELECTIONS || event.button !== 0) return;
    const point = toImage(event);
    onRects([...rects, [point.x, point.y, point.x, point.y]]);
    begin(event, { kind: 'box', start: point, before: layers });
  };

  const layerDown = (event: ReactPointerEvent, layer: EditLayer, kind: Drag['kind']) => {
    if (event.button !== 0) return;
    onSelect(layer.key);
    begin(event, { kind, key: layer.key, start: toImage(event), before: latest.current, layer });
  };

  return (
    <div className="layer-stage" ref={box}>
      <div ref={canvas} className={`layer-stage__canvas${mode === 'split' ? ' is-split' : ''}`}
        style={size ? { width: size.width * scale, height: size.height * scale } : { visibility: 'hidden' }}
        onPointerDown={startBox} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <img className="layer-stage__base" src={url} alt="底图" draggable={false}
          onLoad={event => onNatural?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        {mode === 'edit' ? layers.map(layer => layer.hidden ? null : (
          <div key={layer.key} className={`layer-stage__layer${layer.key === selected ? ' is-selected' : ''}`} title={layer.name}
            style={{ left: layer.x * scale, top: layer.y * scale, width: layer.w * scale, height: layer.h * scale,
              transform: `translate(-50%, -50%) rotate(${layer.rotation}deg)` }}
            onPointerDown={event => layerDown(event, layer, 'move')}>
            <img src={layerUrl(layer.work)} alt={layer.name} draggable={false}
              style={{ transform: `scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})` }} />
            {layer.key === selected ? <>
              <span className="layer-stage__rotate" aria-label="拖动旋转" onPointerDown={event => layerDown(event, layer, 'rotate')} />
              <span className="layer-stage__scale" aria-label="拖动缩放" onPointerDown={event => layerDown(event, layer, 'scale')} />
            </> : null}
          </div>
        )) : rects.map((rect, index) => (
          <div key={index} className="layer-stage__box" style={{ left: Math.min(rect[0], rect[2]) * scale, top: Math.min(rect[1], rect[3]) * scale,
            width: Math.abs(rect[2] - rect[0]) * scale, height: Math.abs(rect[3] - rect[1]) * scale }}>
            <span>选区 {index + 1}</span>
            <button type="button" aria-label={`删掉选区 ${index + 1}`} onPointerDown={event => event.stopPropagation()}
              onClick={() => onRects(rects.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
