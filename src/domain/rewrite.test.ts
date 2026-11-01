import { describe, expect, it, vi } from "vitest";
import { countRewriteRefs, createRewriteAction, referenceDiff } from "./rewrite";
import type { RewriteResult } from "@/types";

const result = (text: string): RewriteResult => ({ text, yuan: 0.0112, model: "model", usage: { input_tokens: 1, output_tokens: 2 } });
function setup(initial = "让@图片1按@视频1和@音频1移动") {
  let prompt = initial;
  let now = 0;
  let resolve!: (value: RewriteResult) => void;
  let reject!: (error: Error) => void;
  const request = vi.fn(() => new Promise<RewriteResult>((yes, no) => { resolve = yes; reject = no; }));
  const notify = vi.fn();
  const onLoading = vi.fn();
  const onError = vi.fn();
  const run = createRewriteAction({
    getInput: () => ({ prompt, kind: "video", refs: { images: 1, videos: 1, audios: 1 } }),
    getPrompt: () => prompt, apply: text => { prompt = text; }, request, notify, onLoading, onError, now: () => now
  });
  return { run, request, notify, onLoading, onError, resolve: (value: RewriteResult) => resolve(value), reject: (error: Error) => reject(error),
    prompt: () => prompt, edit: (text: string) => { prompt = text; }, time: (value: number) => { now = value; } };
}

describe("帮我改写", () => {
  it("引用按图片视频音频各自计数，空的引用不算图片", () => {
    expect(countRewriteRefs([{ media: "audio" }, {}, { media: "video" }, { media: "audio" }])).toEqual({ images: 1, videos: 1, audios: 2 });
  });
  it("比较完整引用集合，重复和重排不误报，增删引用列差异", () => {
    expect(referenceDiff("@图片1 @音频1 @视频2 @图片1", "@视频2 @图片1 @音频1")).toBeNull();
    expect(referenceDiff("@图片1 @视频1 @音频1", "@图片2 @视频1 @音频2")).toEqual({ removed: ["@图片1", "@音频1"], added: ["@图片2", "@音频2"] });
    expect(referenceDiff("@图片1", "@图片10")).toEqual({ removed: ["@图片1"], added: ["@图片10"] });
  });
  it("空提示词不请求，loading锁防连点，成功替换并显示实际四位费用，10秒内撤销", async () => {
    const empty = setup("   "); await empty.run(); expect(empty.request).not.toHaveBeenCalled();
    const s = setup(); const pending = s.run(); await s.run();
    expect(s.request).toHaveBeenCalledExactlyOnceWith({ prompt: s.prompt(), kind: "video", refs: { images: 1, videos: 1, audios: 1 } });
    expect(s.onLoading).toHaveBeenCalledWith(true);
    s.resolve(result("让@图片1模仿@视频1，配合@音频1移动。")); await pending;
    expect(s.prompt()).toContain("模仿");
    const [message, action, ms] = s.notify.mock.calls[0];
    expect(message).toBe("已改写，花费 ¥0.0112"); expect(action.label).toBe("撤销"); expect(ms).toBe(10000);
    s.time(9999); action.run(); expect(s.prompt()).toBe("让@图片1按@视频1和@音频1移动");
    expect(s.onLoading).toHaveBeenLastCalledWith(false);
  });
  it("撤销到期和改写后用户又编辑时不覆盖", async () => {
    for (const mode of ["expired", "edited"] as const) {
      const s = setup("猫"); const pending = s.run(); s.resolve(result("一只猫")); await pending;
      if (mode === "expired") s.time(10000); else s.edit("用户的新句子");
      s.notify.mock.calls[0][1].run(); expect(s.prompt()).toBe(mode === "expired" ? "一只猫" : "用户的新句子");
    }
  });
  it("失败原话保持原文，下一次允许重试", async () => {
    const s = setup("猫"); const pending = s.run(); s.reject(Error("上游拒绝 原话。")); await pending;
    expect(s.prompt()).toBe("猫"); expect(s.onError).toHaveBeenLastCalledWith("上游拒绝 原话。");
    expect(s.notify).toHaveBeenCalledExactlyOnceWith("上游拒绝 原话。");
    const next = s.run(); s.resolve(result("一只猫")); await next; expect(s.request).toHaveBeenCalledTimes(2);
  });
  it("图片视频音频引用改变保留原文并显示增删diff", async () => {
    const s = setup(); const before = s.prompt(); const pending = s.run(); s.resolve(result("@图片2 @视频2 @音频2")); await pending;
    expect(s.prompt()).toBe(before);
    const message = "改写结果改动了 @ 引用（删除：@图片1、@视频1、@音频1；新增：@图片2、@视频2、@音频2），没替换，原文保留";
    expect(s.onError).toHaveBeenLastCalledWith(message);
    expect(s.notify).toHaveBeenCalledExactlyOnceWith(message);
  });
  it("请求期间用户改了文字，保留最新文字", async () => {
    const s = setup("猫"); const pending = s.run(); s.edit("狗"); s.resolve(result("一只猫")); await pending;
    expect(s.prompt()).toBe("狗"); expect(s.onError.mock.calls.at(-1)?.[0]).toContain("提示词已变动");
  });
});
