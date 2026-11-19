import { useEffect, useState } from "react";
import { api } from "@/api";
import { rewriteChangeSeconds, videoRewriteMaterials } from "@/domain/videoRewrite";
import type { CardNode, VideoCardData } from "@/types";
import type { Edge } from "@xyflow/react";
import { productMaterials, productSourceProblem } from '@/domain/productPrompt';
import { sceneTextIds } from '@/domain/rewriteTextScene';
import { talkingLines } from '@/domain/rewriteLines';

/** 免费检查只提示；超时、旧响应和失败都不会触发付费重写。 */
export function useRewritePromptCheck(id: string, data: VideoCardData | { kind: "image" }, nodes: CardNode[], edges: Edge[]) {
  const rewriteId = data.kind === "video" ? data.rewriteId : undefined;
  const prompt = data.kind === "video" ? data.prompt : "";
  const duration = data.kind === "video" ? data.video.duration : 0;
  const product = data.kind === 'video' && data.rewriteKind === 'product';
  const plan = data.kind === 'video' && product ? data.productPlan : undefined;
  const materials = rewriteId ? product ? productMaterials(nodes, edges, id) : videoRewriteMaterials(nodes, edges, id) : [];
  const changeSeconds = data.kind === "video" ? rewriteChangeSeconds(data, product ? [] : materials, sceneTextIds(nodes, data)) : [];
  const materialsKey = JSON.stringify(materials);
  // 11-19 说话版：台词表也送去查，每句都要原样在 {} 里。
  const lines = data.kind === 'video' && !product ? talkingLines(data).map(line => ({ text: line.text })) : [];
  const linesKey = JSON.stringify(lines);
  const key = JSON.stringify([rewriteId, prompt, duration, materialsKey, changeSeconds, plan, linesKey]);
  const [result, setResult] = useState<{ key: string; issues: string[] } | null>(null);
  useEffect(() => {
    if (!rewriteId || !prompt.trim()) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      const check = product ? api.checkProductPrompt({ cardId: id, videoPrompt: prompt, duration, materials: JSON.parse(materialsKey), plan })
        : api.checkVideoPrompt({ cardId: rewriteId, videoPrompt: prompt, duration, materials: JSON.parse(materialsKey), changeSeconds,
          ...(data.kind === 'video' && data.rewriteTalking ? { lines: JSON.parse(linesKey) } : {}) });
      void check.then(
        value => { if (alive) setResult({ key, issues: value.issues }); },
        error => { if (alive) setResult({ key, issues: [`免费检查没完成：${(error as Error).message}`] }); }
      );
    }, 350);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [rewriteId, prompt, duration, materialsKey, key]);
  const sourceProblem = product && data.kind === 'video' ? productSourceProblem({ id, data, nodes, edges }) : null;
  return [...(sourceProblem ? [sourceProblem] : []), ...(rewriteId && result?.key === key ? result.issues : [])];
}
