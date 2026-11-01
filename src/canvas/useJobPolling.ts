import { useEffect, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import { api } from "@/api";
import { isFinished } from "@/domain/cards";
import { absorbJobViews } from "@/domain/jobResults";
import { bumpWorks } from "@/library/worksEvents";
import type { CardNode } from "@/types";

const POLL_MS = 2000;

/**
 * 卡片上有交出去还没收回来的单子，就每 2 秒问一次小服务；跑完的收进卡片（出好的图、失败原因）。
 * 单号存在画布存档里，所以刷新、关浏览器再打开，都会接着问。
 */
export function useJobPolling(nodes: CardNode[], setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void) {
  const { getEdges } = useReactFlow();
  // 拖卡片时 nodes 每帧都变，但单号串不变，下面的 effect 不会重跑。
  const key = useMemo(() => nodes.flatMap((n) => n.data.jobs).join(","), [nodes]);

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const tick = async () => {
      try {
        const views = await api.getJobs(key.split(","));
        const done = views.filter((view) => isFinished(view.status));
        if (!alive) return;
        setNodes(list => absorbJobViews(list, getEdges(), views));
        if (done.length) bumpWorks();
      } catch {
        /* 小服务暂时连不上，下一轮再问 */
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [key, setNodes, getEdges]);
}
