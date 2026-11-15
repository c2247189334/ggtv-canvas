import { useReactFlow, type Edge } from '@xyflow/react';
import { api } from '@/api';
import { currentResult } from '@/domain/cards';
import { localMediaProblem } from '@/domain/localMedia';
import { frameChild, frameSecond, frameTitle, type FrameKind, type Playhead } from '@/domain/videoFrame';
import type { CardNode } from '@/types';
import type { Notify } from '@/common/Toast';

type Deps = { setNodes: (update: (nodes: CardNode[]) => CardNode[]) => void;
  setEdges: (update: (edges: Edge[]) => Edge[]) => void; notify: Notify };

/**
 * 11-09 用户定的视频截图：本机 ffmpeg 按原分辨率截一帧存成上传图，视频右边放一张截图卡并连线。
 * 照参考软件：视频卡保持选中、新卡不选中、视角不动，顶上提示「…已截取，并添加到画布」。
 */
export function useFrameCapture({ setNodes, setEdges, notify }: Deps) {
  const flow = useReactFlow<CardNode, Edge>();
  return async (cardId: string, kind: FrameKind, playhead: Playhead) => {
    const source = flow.getNode(cardId), video = source?.data.kind === 'video' ? currentResult(source.data) : undefined;
    if (!source || !video) return;
    const second = frameSecond(kind, playhead, video.seconds);
    if (second === null) { notify('视频还没加载好，暂时截不了尾帧，请稍后再试。'); return; }
    try {
      const problem = localMediaProblem(await api.health(), 'audio');
      if (problem) { notify(problem); return; }
      const frame = await api.extractFrame({ source: { type: video.type, id: video.id }, second });
      const title = frameTitle(kind, second), id = `card-${crypto.randomUUID().slice(0, 8)}`;
      const latest = flow.getNode(cardId) ?? source;
      // 位置在更新里按最新的卡算：连点几下、几张同时截完也不会叠在同一个位置。
      setNodes(list => [...list, frameChild(latest, video, frame.id, title, id, list).node]);
      setEdges(list => [...list, frameChild(latest, video, frame.id, title, id, []).edge]);
      notify(`${title}已截取，并添加到画布`);
    } catch (error) { notify((error as Error).message); }
  };
}
