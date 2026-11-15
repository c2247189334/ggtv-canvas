import { describe, expect, it } from "vitest";
import { createSendGuard, sendRepeatBlocked } from "./sendGuard";

describe("发送防连点（11-11 体检：两次点击隔 0.15 秒交出两单）", () => {
  it("上一单还在交时，同一张卡再点不算", () => {
    const guard = createSendGuard(() => 0);
    expect(guard.begin("a")).toBe(true);
    expect(guard.begin("a")).toBe(false);
  });

  it("刚交上单 1 秒内再点不算，过了 1 秒可以再发", () => {
    let now = 1000;
    const guard = createSendGuard(() => now);
    expect(guard.begin("a")).toBe(true);
    guard.end("a", true);
    now = 1150;
    expect(guard.begin("a")).toBe(false);
    now = 1999;
    expect(guard.begin("a")).toBe(false);
    now = 2000;
    expect(guard.begin("a")).toBe(true);
  });

  it("没交上（出错）不用等，马上能重试", () => {
    const guard = createSendGuard(() => 500);
    expect(guard.begin("a")).toBe(true);
    guard.end("a", false);
    expect(guard.begin("a")).toBe(true);
  });

  it("不同的卡互不影响", () => {
    const guard = createSendGuard(() => 0);
    expect(guard.begin("a")).toBe(true);
    expect(guard.begin("b")).toBe(true);
    guard.end("a", true);
    expect(guard.begin("b")).toBe(false);
    guard.end("b", true);
    expect(guard.begin("a")).toBe(false);
  });

  it("按住 Ctrl+Enter 不放的自动重复按键不算发送", () => {
    expect(sendRepeatBlocked({ repeat: true })).toBe(true);
    expect(sendRepeatBlocked({ repeat: false })).toBe(false);
    expect(sendRepeatBlocked({})).toBe(false);
  });
});
