import { useCallback } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import { api } from "@/api";
import { sizeOfAspect, sizeSourceOf } from "@/domain/aspects";
import { assetUrl } from "@/domain/cards";
import { loadImageSize } from "@/domain/imagePrep";
import { imageSize } from "@/domain/imageSize";
import { toSendPrompt } from "@/domain/prompt";
import { collectSendRefs } from "@/domain/sendRefs";
import { sentInputsOf } from "@/domain/staleInputs";
import { attachOrphanJobs, findLostJobs, lostReplyMessage, serverRejected } from "@/domain/paidRecovery";
import { submitVideoBatch } from "@/domain/videoSend";
import { rewriteChangeSeconds, videoRewriteMaterials } from '@/domain/videoRewrite';
import { isWorkDeleted } from "@/library/worksEvents";
import { rewriteOutputProblem } from '@/domain/rewriteProgress';
import { productMaterials, productSourceProblem } from '@/domain/productPrompt';
import { sceneTextIds } from '@/domain/rewriteTextScene';
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
      if (card.data.kind === 'video' && card.data.rewriteKind === 'product') {
        const sourceProblem = productSourceProblem({ id: cardId, data: card.data, nodes: flow.getNodes(), edges: flow.getEdges() });
        if (sourceProblem) throw Error(sourceProblem);
      }
      const refs = collectSendRefs(flow.getNodes(), flow.getEdges(), cardId, card.data.kind, isWorkDeleted);
      // 交上单才记下当时的输入，出结果后和现在比，变了卡标题右边亮「输入已更新」（11-08 用户定）。
      const sentInputs = sentInputsOf(flow.getNodes(), flow.getEdges(), cardId);
      // 交单报错时先查这单是不是其实交上去了（回话丢了）：是就接回卡片，别让用户再点一次重复花钱（11-15）。
      const known = [...card.data.jobs];
      const total = card.data.kind === 'video' ? card.data.video.count : 1;
      let sent = 0;
      const rescue = async (error: unknown): Promise<never> => {
        if (serverRejected(error)) throw error;
        const lost = await findLostJobs(canvasId, cardId, known, api.findOrphanJobs);
        if (!lost.length) throw error;
        setNodes(nodes => attachOrphanJobs(nodes, lost).map(n => n.id === cardId ? { ...n, data: { ...n.data, sentInputs } } : n));
        throw new Error(lostReplyMessage(total, sent + lost.length));
      };
      if (card.data.kind === "video") {
        if (card.data.rewriteId) {
          const materials = videoRewriteMaterials(flow.getNodes(), flow.getEdges(), cardId);
          const checked = card.data.rewriteKind === 'product'
            ? await api.checkProductPrompt({ cardId, videoPrompt: card.data.prompt, duration: card.data.video.duration,
              materials: productMaterials(flow.getNodes(), flow.getEdges(), cardId), plan: card.data.productPlan })
            : await api.checkVideoPrompt({ cardId, videoPrompt: card.data.prompt, duration: card.data.video.duration,
              materials, changeSeconds: rewriteChangeSeconds(card.data, materials, sceneTextIds(flow.getNodes(), card.data)) });
          if (checked.issues.length) throw new Error(checked.issues.join('\n'));
        }
        await submitVideoBatch({ card: card.data, canvasId, cardId, refs, health: await api.health(),
          submit: request => api.submitVideoJob(request).catch(rescue),
          clear: () => setNodes(nodes => nodes.map(n => n.id === cardId ? { ...n, data: { ...n.data, blocked: [], note: null } } : n)),
          submitted: id => { known.push(id); sent++; return setNodes(nodes => nodes.map(n => n.id === cardId ? { ...n, data: { ...n.data, jobs: [...n.data.jobs, id], phase: null, sentInputs } } : n)); }
        });
        return;
      }
      const { gen } = card.data;
      const prompt = toSendPrompt(card.data.prompt, refs.length);
      const source = sizeSourceOf(gen.sizeFrom, refs.length);
      const size = "aspect" in source
        ? sizeOfAspect(gen.aspect, gen.resolution)
        : imageSize(await loadImageSize(assetUrl(refs[source.ref - 1])), gen.resolution);
      const { id: jobId } = await api.submitJob({ canvasId, cardId, model: gen.model, prompt, size, count: gen.count, refs }).catch(rescue);
      setNodes((nodes) => nodes.map((n) => (n.id === cardId ? { ...n, data: { ...n.data, jobs: [...n.data.jobs, jobId], note: null, blocked: [], sentInputs } } : n)));
    },
    [flow, canvasId, setNodes]
  );
}
