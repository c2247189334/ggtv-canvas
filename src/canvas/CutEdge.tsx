import { createContext, useContext, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, useStore, type EdgeProps } from "@xyflow/react";
import { canCutEdge, nearestPointOnPolyline } from "@/domain/edgeCut";
import type { Point } from "@/domain/placement";

export const EdgeCutRefPickContext = createContext(false);

export function CutEdge(props: EdgeProps) {
  const refPicking = useContext(EdgeCutRefPickContext);
  const flow = useReactFlow();
  const blocked = useStore(state => !canCutEdge({
    refPicking: false, connecting: state.connection.inProgress,
    selecting: state.userSelectionActive || state.userSelectionRect !== null,
    dragging: state.paneDragging || state.nodes.some(node => node.dragging)
  }));
  const zoom = useStore(state => state.transform[2]);
  const enabled = !blocked && !refPicking;
  const [path] = getBezierPath({ ...props, curvature: props.pathOptions?.curvature });
  const group = useRef<SVGGElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const samples = useRef<{ path: string; zoom: number; points: Point[] } | null>(null);
  const press = useRef<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  useLayoutEffect(() => {
    setHover(null);
    press.current = null;
  }, [enabled, path, zoom]);

  const onMove = (event: MouseEvent) => {
    if (!enabled || event.buttons !== 0) return;
    const element = group.current?.querySelector<SVGPathElement>(".react-flow__edge-path");
    if (!element) return;
    if (samples.current?.path !== path || samples.current.zoom !== zoom) {
      const length = element.getTotalLength();
      // 每两屏幕像素采样一次；同一路径和缩放下复用，鼠标移动只做投影。
      const count = Math.max(1, Math.ceil(length * zoom / 2));
      const points = Array.from({ length: count + 1 }, (_, index) => {
        const point = element.getPointAtLength(length * index / count);
        return { x: point.x, y: point.y };
      });
      samples.current = { path, zoom, points };
    }
    setHover(nearestPointOnPolyline(samples.current.points,
      flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false })));
  };
  const onLeave = (event: MouseEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (group.current?.contains(next) || button.current?.contains(next))) return;
    setHover(null);
    press.current = null;
  };
  const onDown = (event: PointerEvent) => {
    press.current = enabled && event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  };
  const cut = (event: MouseEvent) => {
    const start = press.current;
    press.current = null;
    if (!enabled || event.button !== 0 || !start || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 5) return;
    event.preventDefault();
    event.stopPropagation();
    flow.setEdges(edges => edges.filter(edge => edge.id !== props.id));
  };

  return <>
    <g ref={group} className="cut-edge" onMouseEnter={onMove} onMouseMove={onMove}
      onMouseLeave={onLeave} onPointerDown={onDown} onClick={cut}>
      <BaseEdge path={path} style={props.style} markerStart={props.markerStart}
        markerEnd={props.markerEnd} interactionWidth={props.interactionWidth} />
      {enabled && hover ? <path d={path} className="cut-edge__highlight" /> : null}
    </g>
    {enabled && hover ? <EdgeLabelRenderer>
      <button ref={button} type="button" data-edge-cut="" className="cut-edge__button nodrag nopan"
        aria-label="剪断连线" title="剪断连线" tabIndex={-1}
        style={{ transform: `translate(${hover.x}px, ${hover.y}px) scale(${1 / zoom}) translate(-50%, -50%)` }}
        onMouseEnter={onMove} onMouseMove={onMove} onMouseLeave={onLeave}
        onPointerDown={onDown} onClick={cut}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
          <path d="M8.2 8.2 20 20M8.2 15.8 20 4" />
        </svg>
      </button>
    </EdgeLabelRenderer> : null}
  </>;
}
