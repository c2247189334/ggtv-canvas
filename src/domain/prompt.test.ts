import { describe, expect, it } from "vitest";
import { appendToken, refToken, toSendPrompt } from "./prompt";

describe("toSendPrompt", () => {
  it("没连图：原样发，只去首尾空白", () => {
    expect(toSendPrompt("  一只猫 ", 0)).toBe("一只猫");
  });

  it("连了 1 张：前面加编号说明，@图片1 换成 图1", () => {
    expect(toSendPrompt("把 @图片1 换成蓝色", 1)).toBe("只有 1 张图，就是图1。\n\n把 图1 换成蓝色");
  });

  it("连了 3 张：说明里按顺序列出", () => {
    expect(toSendPrompt("x", 3)).toBe("一共 3 张图，按顺序是图1、图2、图3。\n\nx");
  });

  it("空的报错", () => {
    expect(() => toSendPrompt("   ", 1)).toThrow("先写一句");
  });

  it("引用了没连的图报错", () => {
    expect(() => toSendPrompt("@图片3", 2)).toThrow("只连了 2 张");
  });

  it("没连图却写了 @图片1 报错", () => {
    expect(() => toSendPrompt("@图片1", 0)).toThrow("还没连参考图");
  });
});

describe("appendToken", () => {
  it("接到末尾，前后补空格", () => {
    expect(refToken(2)).toBe("@图片2");
    expect(appendToken("", "@图片1")).toBe("@图片1 ");
    expect(appendToken("把", "@图片1")).toBe("把 @图片1 ");
    expect(appendToken("把 ", "@图片2")).toBe("把 @图片2 ");
  });
});
