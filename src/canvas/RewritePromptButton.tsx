import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { createLookPromptAction, lookPromptPaid, lookPromptProblem, lookPromptStartedAt, lookPromptVersion, subscribeLookPrompt } from '@/domain/rewritePrompt';
import { formatYuan } from '@/domain/pricing';
import type { CardNode, VideoCardData } from '@/types';
import type { BoardApi } from './boardContext';

type ViewProps = { reason: string | null; loading: boolean; paid?: boolean; estimate?: number | null; onRun: () => void };
/** 提示词由小服务按拆解结果和连入的图片拼；连了要换的人物图要先看一次图（花钱），按钮写估价，没有就免费马上出。 */
export function RewritePromptButtonView({ reason, loading, paid = false, estimate = null, onRun }: ViewProps) {
  const label = loading ? (paid ? '正在看图…' : '正在生成…')
    : paid ? `生成提示词 ${estimate === null ? '估价读取中…' : formatYuan(estimate)}` : '生成提示词（免费）';
  return <span>
    <button type="button" className="rewrite-prompt-button" aria-label="生成提示词"
      title={reason ?? (paid ? '先看一次人物图认衣服和发型，会产生费用，再按模板拼提示词' : '按拆解结果和连入的图片拼提示词，不花钱')}
      disabled={Boolean(reason) || loading || (paid && estimate === null)} onClick={onRun}>
      {label}
    </button>
    {reason && !loading ? <span className="rewrite-prompt-reason">{reason}</span> : null}
  </span>;
}

export function RewritePromptButton({ id, data, nodes, edges, board }: {
  id: string; data: VideoCardData; nodes: CardNode[]; edges: Edge[]; board: BoardApi;
}) {
  const flow = useReactFlow<CardNode, Edge>();
  const latest = useRef({ flow, board }); latest.current = { flow, board };
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  useSyncExternalStore(subscribeLookPrompt, lookPromptVersion, lookPromptVersion);
  const loading = lookPromptStartedAt(id) !== undefined;
  const paid = lookPromptPaid({ id, data, nodes, edges });
  useEffect(() => {
    if (!paid) return;
    let alive = true;
    void api.videoRewriteEstimates().then(value => {
      if (!alive) return;
      if (typeof value.lookYuan === 'number') setEstimate(value.lookYuan);
      else setError('估价没读到：小服务没给看图估价，关掉黑窗口重新双击 一键启动.bat 再试。');
    },
      reason => { if (alive) setError(`估价没读到：${(reason as Error).message}`); });
    return () => { alive = false; };
  }, [paid]);
  const [run] = useState(() => createLookPromptAction({
    getState: () => {
      const current = latest.current.flow.getNode(id);
      return current?.data.kind === 'video' ? { id, data: current.data, nodes: latest.current.flow.getNodes(), edges: latest.current.flow.getEdges() } : null;
    },
    request: input => api.writeVideoPrompt(input), apply: patch => latest.current.board.updateCard(id, patch),
    notify: (text, action, ms) => latest.current.board.notify(text, action, ms), onError: setError
  }));
  const reason = lookPromptProblem({ id, data, nodes, edges }, loading);
  return <>
    <RewritePromptButtonView reason={reason} loading={loading} paid={paid} estimate={estimate} onRun={() => void run()} />
    {error ? <div className="panel__error">{error}</div> : null}
  </>;
}
