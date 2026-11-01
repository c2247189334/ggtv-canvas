import { expect, it, vi } from "vitest";

// 使用真实文件读取；项目没有安装 Node 类型，不为样式测试增加依赖。
const { readFileSync } = await vi.importActual<{
  readFileSync: (path: URL, encoding: "utf8") => string;
}>("node:fs");

const worksCss = readFileSync(new URL("./works.css", import.meta.url), "utf8");

// 作品多到超出侧栏高度时，自动行高会被压进容器高度，正方形格子就上下叠在一起（10-30 实测行高 77、格子 126）。
it("作品网格行高跟着格子走，不被侧栏高度压扁", () => {
  const grid = worksCss.match(/\.works__grid\s*\{([^}]*)\}/)?.[1] ?? "";
  expect(grid).toMatch(/grid-auto-rows:\s*max-content/);
});
