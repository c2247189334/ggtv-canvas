import { useCallback, useEffect, useMemo, useRef } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { api } from "@/api";
import { currentResult } from "@/domain/cards";
import { localChild, localMediaProblem, settleDepth, type LocalAction } from "@/domain/localMedia";
import { bumpWorks } from "@/library/worksEvents";
import type { Notify } from "@/common/Toast";
import type { CardNode } from "@/types";

type Deps = { canvasId: string; nodes: CardNode[]; setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; takeNumber: () => number; notify: Notify };

export function useLocalMedia({ canvasId, nodes, setNodes, setEdges, takeNumber, notify }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  const pending = useRef(new Set<string>());
  const key = useMemo(() => nodes.flatMap(node => node.data.depthJobId ? [node.data.depthJobId] : []).join(","), [nodes]);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    let polling = false;
    const tick = async () => {
      if (polling) return;
      polling = true;
      try {
        const views = await api.getDepthJobs(key.split(","));
        if (!alive) return;
        setNodes(list => list.map(node => {
          const view = views.find(job => job.id === node.data.depthJobId);
          if (!view) return node;
          const data = settleDepth(node.data, view);
          return data === node.data ? node : { ...node, data };
        }));
        if (views.some(view => view.works.length)) bumpWorks();
      } catch (error) {
        if (alive) notify((error as Error).message);
      } finally { polling = false; }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [key, setNodes, notify]);

  return useCallback(async (sourceId: string, action: LocalAction, resolution: "480p" | "720p" = "480p") => {
    if (pending.current.has(sourceId)) return;
    pending.current.add(sourceId);
    let createdId: string | null = null;
    try {
      const problem = localMediaProblem(await api.health(), action);
      if (problem) { notify(problem); return; }
      const source = flow.getNode(sourceId);
      const asset = source && currentResult(source.data);
      if (!source || !asset || source.data.kind !== "video" || asset.depth || asset.mesh || source.data.source === "depth" || source.data.source === 'mesh') return;
      if (action === "audio" && asset.hasAudio === false) { notify("这段视频没有声音"); return; }
      const id = `card-${crypto.randomUUID().slice(0, 8)}`;
      const placed = flow.getNodes().map(node => ({ ...node, measured: flow.getInternalNode(node.id)?.measured ?? node.measured }));
      const created = localChild(source, action, takeNumber(), id, new Date().toISOString(), placed);
      createdId = id;
      setNodes(list => [...list.map(node => node.selected ? { ...node, selected: false } : node), created.node]);
      setEdges(list => [...list, created.edge]);
      const request = { source: { type: asset.type, id: asset.id }, canvasId, cardId: id };
      if (action !== "audio") {
        const job = action === 'mesh' ? await api.submitMeshJob(request) : await api.submitDepthJob({ ...request, resolution });
        setNodes(list => list.map(node => node.id === id ? { ...node, data: { ...node.data, depthJobId: job.id } } : node));
      } else {
        const work = await api.extractAudio(request);
        setNodes(list => list.map(node => node.id === id ? { ...node, data: { ...node.data, results: [{ type: "work", id: work.id, media: "audio", seconds: work.duration }], note: null, startedAt: undefined } } : node));
        bumpWorks();
      }
    } catch (error) {
      const message = (error as Error).message;
      if (createdId) setNodes(list => list.map(node => node.id === createdId ? { ...node, data: { ...node.data, note: message, depthJobId: undefined, startedAt: undefined } } : node));
      else notify(message);
    } finally { pending.current.delete(sourceId); }
  }, [canvasId, flow, notify, setNodes, setEdges, takeNumber]);
}
