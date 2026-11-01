import { useCallback } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { api } from "@/api";
import { busyLocalJobs } from "@/domain/localMedia";
import type { Notify } from "@/common/Toast";
import type { CardNode } from "@/types";

/** 10-31 用户：深度 / 白模要能停。按卡找单号发停止，卡上的结果照常由轮询收（写「已停止」）。 */
export function useLocalStop(notify: Notify) {
  const flow = useReactFlow<CardNode, Edge>();
  return useCallback(async (cardIds: string[]) => {
    const nodes = cardIds.flatMap(id => { const node = flow.getNode(id); return node ? [node] : []; });
    for (const jobId of busyLocalJobs(nodes)) {
      try { await api.stopLocalJob(jobId); }
      catch (error) {
        const message = (error as Error).message;
        if (!message.includes("已经结束")) notify(`停止失败：${message}`);
      }
    }
  }, [flow, notify]);
}
