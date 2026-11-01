import { toVideoPrompt } from "./videoPrompt";
import { videoProblems } from "./videoPanel";
import { rewriteOutputProblem } from './rewriteProgress';
import type { SendRef } from "./sendRefs";
import type { Health, VideoCardData, VideoJobRequest } from "@/types";

type Batch = {
  card: VideoCardData; canvasId: string; cardId: string; refs: SendRef[];
  health: Pick<Health, "fake" | "tosReady">;
  submit: (request: VideoJobRequest) => Promise<{ id: string }>;
  clear: () => void; submitted: (id: string) => void;
};

/** 按数量依次交单，立即记录每个成功提交的单号；中途拒单不丢前单。 */
export async function submitVideoBatch({ card, canvasId, cardId, refs, health, submit, clear, submitted }: Batch): Promise<void> {
  const problem = rewriteOutputProblem(card);
  if (problem) throw new Error(problem);
  const videos = refs.filter(ref => ref.media === "video").length;
  const audios = refs.filter(ref => ref.media === "audio").length;
  const prompt = toVideoPrompt(card.prompt, refs.length - videos - audios, videos, audios, Boolean(card.rewriteId));
  const problems = videoProblems(card.video, refs, health);
  if (problems.length) throw new Error(problems.join("\n"));
  const { count, ...settings } = card.video;
  // 改写视频关着生成音频、原片有声音：出好后小服务把原片声音配回去（10-30 用户定）。
  const source = card.rewriteSource;
  const soundtrack = card.rewriteId && !settings.audio && source?.media === 'video' && source.hasAudio ? { type: source.type, id: source.id } : undefined;
  // 任务类型只有 2.5 认；改写卡换成 2.0 时不带，否则小服务拒单（11-01 用户定 2.0 也要能发）。
  const withTaskType = Boolean(card.rewriteId) && settings.model === 'doubao-seedance-2-5-260628';
  const request: VideoJobRequest = { ...settings, canvasId, cardId, prompt,
    ...(withTaskType ? { taskType: 'reference' as const } : {}), ...(soundtrack ? { soundtrack } : {}),
    refs: refs.map(({ type, id, asset }) => ({ type, id, ...(asset ? { asset } : {}) })) };
  clear();
  for (let index = 0; index < count; index++) {
    const result = await submit(request);
    submitted(result.id);
  }
}
