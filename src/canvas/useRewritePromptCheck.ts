import { useEffect, useState } from "react";
import { api } from "@/api";
import { rewriteChangeSeconds, videoRewriteMaterials } from "@/domain/videoRewrite";
import type { CardNode, VideoCardData } from "@/types";
import type { Edge } from "@xyflow/react";

/** 免费检查只提示；超时、旧响应和失败都不会触发付费重写。 */
export function useRewritePromptCheck(id: string, data: VideoCardData | { kind: "image" }, nodes: CardNode[], edges: Edge[]) {
  const rewriteId = data.kind === "video" ? data.rewriteId : undefined;
  const prompt = data.kind === "video" ? data.prompt : "";
  const duration = data.kind === "video" ? data.video.duration : 0;
  const changeSeconds = data.kind === "video" ? rewriteChangeSeconds(data) : [];
  const materials = rewriteId ? videoRewriteMaterials(nodes, edges, id) : [];
  const materialsKey = JSON.stringify(materials);
  const key = JSON.stringify([rewriteId, prompt, duration, materialsKey, changeSeconds]);
  const [result, setResult] = useState<{ key: string; issues: string[] } | null>(null);
  useEffect(() => {
    if (!rewriteId || !prompt.trim()) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void api.checkVideoPrompt({ cardId: rewriteId, videoPrompt: prompt, duration, materials: JSON.parse(materialsKey), changeSeconds }).then(
        value => { if (alive) setResult({ key, issues: value.issues }); },
        error => { if (alive) setResult({ key, issues: [`免费检查没完成：${(error as Error).message}`] }); }
      );
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [rewriteId, prompt, duration, materialsKey, key]);
  return rewriteId && result?.key === key ? result.issues : [];
}
