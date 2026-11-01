import { describe, expect, it } from "vitest";
import { insertMention, mentionTrigger } from "./mention";

describe("mention", () => {
  it("刚插入一个@时打开列表，返回它的位置", () => {
    expect(mentionTrigger("画一只猫", "画一只猫@", 5)).toBe(4);
    expect(mentionTrigger("前后", "前@后", 2)).toBe(1);
  });
  it("输入普通字符、已有@、粘贴一段文本都不开", () => {
    expect(mentionTrigger("@", "@猫", 2)).toBeNull();
    expect(mentionTrigger("@", "@", 1)).toBeNull();
    expect(mentionTrigger("", "@图片1", 4)).toBeNull();
    expect(mentionTrigger("", "猫", 1)).toBeNull();
    expect(mentionTrigger("", "@", 0)).toBeNull();
  });
  it("选中文字后打@也打开列表", () => {
    expect(mentionTrigger("前一段文字后", "前@后", 2, { start: 1, end: 5 })).toBe(1);
    expect(mentionTrigger("猫", "@", 1, { start: 0, end: 1 })).toBe(0);
  });
  it("只替换刚打的@，保留两侧文字并返回末尾光标位置", () => {
    expect(insertMention("前@后@", 1, 2)).toEqual({ text: "前@图片2 后@", caret: 6 });
    expect(insertMention("@", 0, 12)).toEqual({ text: "@图片12 ", caret: 6 });
  });
  it("@被删掉或位置失效时保留当前文字", () => {
    expect(insertMention("猫", 0, 1)).toBeNull();
    expect(insertMention("@", -1, 1)).toBeNull();
  });
});
