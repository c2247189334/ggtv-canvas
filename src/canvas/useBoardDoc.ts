import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEdgesState, useNodesState, type Edge } from "@xyflow/react";
import { api } from "@/api";
import type { Notify } from "@/common/Toast";
import { fromDoc, toDoc } from "@/domain/canvasDoc";
import type { CanvasDoc, CardNode } from "@/types";
import { cardCounter } from "@/domain/cards";
import { CANVAS_CONFLICT, createCanvasSaver } from '@/domain/canvasSave';
import { recoverLocalJobs } from '@/domain/localRecovery';

/** 停手多久后自动存。 */
const SAVE_DELAY_MS = 800;
// 同一标签页切换画布也不解除冲突锁；刷新页面后模块重新加载才可继续保存。
const blockedCanvases = new Set<string>();

/**
 * 一张画布的卡片和连线：打开时从小服务读；改了自动存（停手 0.8 秒存一次），换画布、关页面前把没存的存掉。
 * 只有位置、连线、卡片内容变了才存；选中、拖动中这类临时状态不算（toDoc 不收它们）。
 */
export function useBoardDoc(canvasId: string, name: string, notify: Notify) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const counter = useRef(cardCounter());
  const saver = useRef<ReturnType<typeof createCanvasSaver> | null>(null);

  useEffect(() => {
    let alive = true;
    api.getCanvas(canvasId).then(
      async (doc) => {
        if (!alive) return;
        const loaded = fromDoc(doc);
        const restored = await recoverLocalJobs(canvasId, loaded.nodes, api.findLocalJobs);
        if (!alive) return;
        counter.current = cardCounter();
        saver.current = createCanvasSaver({ initial: toDoc(loaded.meta, loaded.nodes, loaded.edges), version: doc.version ?? 0,
          save: api.saveCanvas, notify: message => { if (message === CANVAS_CONFLICT) blockedCanvases.add(canvasId); notify(message); } });
        setNodes(restored);
        setEdges(loaded.edges);
        setReady(true);
      }
    ).catch((err: Error) => { if (alive) setLoadError(err.message); });
    return () => {
      alive = false;
    };
  }, [canvasId, setNodes, setEdges, notify]);

  const docText = useMemo(
    () => (ready ? JSON.stringify(toDoc({ id: canvasId, name }, nodes, edges)) : null),
    [ready, canvasId, name, nodes, edges]
  );
  const latest = useRef(docText);
  latest.current = docText;

  /** silent：换画布 / 关页面时存，失败也不弹提示（比如这张刚被删了，小服务回 404 是对的）。 */
  const save = useCallback(
    (options: { keepalive?: boolean; silent?: boolean } = {}) => {
      const text = latest.current;
      if (!text || !saver.current || blockedCanvases.has(canvasId)) return;
      saver.current.update(JSON.parse(text) as CanvasDoc);
      void saver.current.save(options);
    },
    [canvasId]
  );

  useEffect(() => {
    if (!docText || saver.current?.blocked || blockedCanvases.has(canvasId)) return;
    const timer = window.setTimeout(() => save(), SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [docText, save]);

  useEffect(() => {
    const onLeave = () => save({ keepalive: true, silent: true });
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("beforeunload", onLeave);
      save({ silent: true });
    };
  }, [save]);

  const takeNumber = useCallback(() => counter.current(), []);

  return { ready, loadError, nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange, takeNumber };
}
