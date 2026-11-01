import { describe, expect, it, vi } from "vitest";

// 使用真实文件读取；项目没有安装 Node 类型，不为样式测试增加依赖。
const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: "utf8") => string;
}>("node:fs");

const boardCss = readFileSync(new URL("./board.css", import.meta.url), "utf8");
const panelCss = readFileSync(new URL("./panel.css", import.meta.url), "utf8");
const cardCss = readFileSync(new URL("./card.css", import.meta.url), "utf8");

function userSelect(css: string, selector: string) {
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const values: string[] = [];
  for (const [, selectors, declarations] of rules) {
    if (!selectors.split(",").map(value => value.trim()).includes(selector)) continue;
    for (const declaration of declarations.split(";")) {
      const match = declaration.match(/^\s*user-select\s*:\s*(\S+)\s*$/);
      if (match) values.push(match[1]);
    }
  }
  return values.at(-1);
}

describe("画布文字选择样式", () => {
  it.each([
    [".board", boardCss],
    [".panel-popup", panelCss],
    [".pop-menu", boardCss]
  ])("%s 禁止选择普通文字", (selector, css) => {
    expect(userSelect(css, selector)).toBe("none");
  });

  it.each([".board", ".panel-popup", ".pop-menu"].flatMap(root =>
    ["input", "textarea", "[contenteditable]"].map(field => `${root} ${field}`)
  ))("%s 显式保留文字选择和编辑", selector => {
    expect(userSelect(boardCss, selector)).toBe("text");
  });

  it.each([
    [".panel__error", panelCss],
    [".card__note", cardCss]
  ])("%s 显式允许复制出错原话", (selector, css) => {
    expect(userSelect(css, selector)).toBe("text");
  });
});
