import { formatSpent } from "./pricing";
import type { RewriteResult } from "@/types";

export type RewriteRefs = { images: number; videos: number; audios: number };
export type RewriteInput = { prompt: string; kind: "image" | "video"; refs: RewriteRefs };
type Action = { label: string; run: () => void };
type RewriteOptions = {
  getInput: () => RewriteInput;
  getPrompt: () => string;
  apply: (text: string) => void;
  request: (input: RewriteInput) => Promise<RewriteResult>;
  notify: (text: string, action?: Action, ms?: number) => void;
  onLoading: (loading: boolean) => void;
  onError: (error: string | null) => void;
  now?: () => number;
};

export function countRewriteRefs(refs: ReadonlyArray<{ media?: "image" | "video" | "audio" }>): RewriteRefs {
  return { images: refs.filter(ref => !ref.media || ref.media === "image").length,
    videos: refs.filter(ref => ref.media === "video").length, audios: refs.filter(ref => ref.media === "audio").length };
}

export function referenceDiff(before: string, after: string) {
  const tokens = (text: string) => [...new Set(text.match(/@(?:图片|视频|音频)\d+/g) ?? [])];
  const oldTokens = tokens(before), newTokens = tokens(after);
  const removed = oldTokens.filter(token => !newTokens.includes(token));
  const added = newTokens.filter(token => !oldTokens.includes(token));
  return removed.length || added.length ? { removed, added } : null;
}

/** 一次只发一单；异步回话与撤销都先保护用户后来编辑的文字。 */
export function createRewriteAction(options: RewriteOptions) {
  let loading = false;
  const now = options.now ?? Date.now;
  const report = (message: string) => { options.onError(message); options.notify(message); };
  return async () => {
    const input = options.getInput();
    if (loading || !input.prompt.trim()) return;
    loading = true;
    options.onLoading(true);
    options.onError(null);
    try {
      const result = await options.request(input);
      if (options.getPrompt() !== input.prompt) {
        report("改写期间提示词已变动，已保留你现在的文字。");
        return;
      }
      const diff = referenceDiff(input.prompt, result.text);
      if (diff) {
        report(`改写结果改动了 @ 引用（删除：${diff.removed.join("、") || "无"}；新增：${diff.added.join("、") || "无"}），没替换，原文保留`);
        return;
      }
      options.apply(result.text);
      const deadline = now() + 10000;
      options.notify(`已改写，花费 ${formatSpent(result.yuan)}`, { label: "撤销", run: () => {
        if (now() < deadline && options.getPrompt() === result.text) options.apply(input.prompt);
      } }, 10000);
    } catch (error) {
      report((error as Error).message);
    } finally {
      loading = false;
      options.onLoading(false);
    }
  };
}
