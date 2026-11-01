import { useCallback } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { api } from "@/api";
import { sizeOfAspect, sizeSourceOf } from "@/domain/aspects";
import { assetUrl } from "@/domain/cards";
import { loadImageSize } from "@/domain/imagePrep";
import { imageSize } from "@/domain/imageSize";
import { toSendPrompt } from "@/domain/prompt";
import { collectSendRefs } from "@/domain/sendRefs";
import { submitVideoBatch } from "@/domain/videoSend";
import { rewriteChangeSeconds, videoRewriteMaterials } from '@/domain/videoRewrite';
import { isWorkDeleted } from "@/library/worksEvents";
import { rewriteOutputProblem } from '@/domain/rewriteProgress';
import type { CardNode } from "@/types";

/**
 * 点「发送」：每张上游卡当前翻到的那张当参考图，连同提示词、尺寸交给小服务排队。
 * 出错直接抛人话（面板上显示）；交上去以后把单号记进卡片，卡片显示「生成中」。
 */
export function useSend(canvasId: string, setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void) {
  const flow = useReactFlow<CardNode, Edge>();
  return useCallback(
    async (cardId: string) => {
      const card = flow.getNode(cardId);
      if (!card) throw new Error("这张卡已经不在了。");
      if (card.data.kind === "audio" || card.data.source !== "generate") throw new Error("只有生成卡可以发送。");
      const problem = card.data.kind === 'video' ? rewriteOutputProblem(card.data) : null;
      if (problem) throw new Error(problem);
      const refs = collectSendRefs(flow.getNodes(), flow.getEdges(), cardId, card.data.kind, isWorkDeleted);
      if (card.data.kind === "video") {
        if (card.data.rewriteId) {
          const checked = await api.checkVideoPrompt({ cardId, videoPrompt: card.data.prompt, duration: card.data.video.duration,
            materials: videoRewriteMaterials(flow.getNodes(), flow.getEdges(), cardId), changeSeconds: rewriteChangeSeconds(card.data) });
          if (checked.issues.length) throw new Error(checked.issues.join('\n'));
        }
        await submitVideoBatch({ card: card.data, canvasId, cardId, refs, health: await api.health(), submit: api.submitVideoJob,
          clear: () => setNodes(nodes => nodes.map(n => n.id === cardId ? { ...n, data: { ...n.data, blocked: [], note: null } } : n)),
          submitted: id => setNodes(nodes => nodes.map(n => n.id === cardId ? { ...n, data: { ...n.data, jobs: [...n.data.jobs, id], phase: null } } : n))
        });
        return;
      }
      const { gen } = card.data;
      const prompt = toSendPrompt(card.data.prompt, refs.length);
      const source = sizeSourceOf(gen.sizeFrom, refs.length);
      const size = "aspect" in source
        ? sizeOfAspect(gen.aspect, gen.resolution)
        : imageSize(await loadImageSize(assetUrl(refs[source.ref - 1])), gen.resolution);
      const { id: jobId } = await api.submitJob({ canvasId, cardId, model: gen.model, prompt, size, count: gen.count, refs });
      setNodes((nodes) => nodes.map((n) => (n.id === cardId ? { ...n, data: { ...n.data, jobs: [...n.data.jobs, jobId], note: null, blocked: [] } } : n)));
    },
    [flow, canvasId, setNodes]
  );
}
