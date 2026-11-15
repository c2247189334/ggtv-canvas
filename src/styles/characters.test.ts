import { expect, it, vi } from "vitest";

// 同 works.test.ts：使用真实文件读取，不为样式测试增加依赖。
const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: "utf8") => string;
}>("node:fs");

const css = readFileSync(new URL("./characters.css", import.meta.url), "utf8");
const rule = (selector: string) =>
  css.match(new RegExp(`^${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`, "m"))?.[1] ?? "";

// 设定图是 16:9，原来 3:4 固定框 + contain 让人物卡上下各空一大块（11-03 实测框高 339、图只占 143）。
it("人物卡有图时框跟着图的比例走，不留上下空白", () => {
  expect(rule(".character-card__image.has-image")).toMatch(/aspect-ratio:\s*auto/);
  expect(rule(".character-card__image img")).toMatch(/height:\s*auto/);
});

// 详情里原来固定 260×240 方框，16:9 的图上下空 94。
it("人物详情的图宽度跟着图走，不塞进固定方框", () => {
  expect(rule(".character-detail__images img")).toMatch(/width:\s*auto/);
});
