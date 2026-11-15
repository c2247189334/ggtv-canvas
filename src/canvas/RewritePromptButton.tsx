import { useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { agentReadyOrAsk } from '@/common/agentNeeded';
import { createLookPromptAction, lookPromptPaid, lookPromptProblem, lookPromptStartedAt, lookPromptVersion, subscribeLookPrompt } from '@/domain/rewritePrompt';
import type { CardData, CardNode } from '@/types';
import type { BoardApi } from './boardContext';
import { createProductPromptAction, productPromptProblem } from '@/domain/productPrompt';

type ViewProps = { reason: string | null; loading: boolean; paid?: boolean; onRun: () => void; product?: boolean };
/** 提示词由小服务按拆解结果和连入的图片拼，再由本机 agent 看图定稿（11-15 起只走本机 agent，免费）。
 * 11-04：按钮放面板那排小按钮里；不能点的原因由面板写在提示词框下面（顺序：按钮排 → 缩略图 → 提示词框）。 */
export function RewritePromptButtonView({ reason, loading, paid = false, onRun, product }: ViewProps) {
  const label = loading ? (paid ? '正在看图…' : '正在生成…') : '生成提示词（免费）';
  return <button type="button" aria-label="生成提示词"
    title={reason ?? `${paid ? product ? '先看一次商品实物照，再按五段模板拼提示词' : '先看一次人物图认衣服和发型，再按模板拼提示词' : '按拆解结果和连入的图片拼提示词'}；再由本机 agent 对照参考图和原片抽帧改错、过程序检查才填进来（约 1~2 分钟）`}
    disabled={Boolean(reason) || loading} onClick={onRun}>
    {label}
  </button>;
}

/** 面板对所有卡都调用；不是改写视频卡就返回 null。 */
export function useRewritePrompt(id: string, data: CardData, nodes: CardNode[], edges: Edge[], board: BoardApi) {
  const video = data.kind === 'video' && data.rewriteId ? data : null;
  const flow = useReactFlow<CardNode, Edge>();
  const latest = useRef({ flow, board }); latest.current = { flow, board };
  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(subscribeLookPrompt, lookPromptVersion, lookPromptVersion);
  const loading = lookPromptStartedAt(id) !== undefined;
  const product = video?.rewriteKind === 'product';
  const paid = video !== null && (product || lookPromptPaid({ id, data: video, nodes, edges }));
  const [run] = useState(() => {
    const options = {
    getState: () => {
      const current = latest.current.flow.getNode(id);
      return current?.data.kind === 'video' ? { id, data: current.data, nodes: latest.current.flow.getNodes(), edges: latest.current.flow.getEdges() } : null;
    },
      apply: (patch: Parameters<BoardApi['updateCard']>[1]) => latest.current.board.updateCard(id, patch),
      notify: ((text, action, ms) => latest.current.board.notify(text, action, ms)) as BoardApi['notify'], onError: setError
    };
    return product ? createProductPromptAction({ ...options, request: api.writeProductPrompt })
      : createLookPromptAction({ ...options, request: api.writeVideoPrompt });
  });
  if (!video) return null;
  const reason = (product ? productPromptProblem : lookPromptProblem)({ id, data: video, nodes, edges }, loading);
  return { view: { reason, loading, paid, product, onRun: () => void agentReadyOrAsk().then(ok => { if (ok) void run(); }) }, error };
}
