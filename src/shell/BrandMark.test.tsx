import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandCredit, BrandMark } from "./BrandMark";

describe("左上 GG TV 标志", () => {
  it("读屏念 GG TV，只有 G G T V 四个字形、不带外圈和碎片", () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('aria-label="GG TV"');
    expect(html.match(/<path /g)).toHaveLength(4);
    expect(html).not.toContain("<circle");
  });

  it("只展示，不是能点的按钮", () => {
    expect(renderToStaticMarkup(<BrandMark />)).not.toContain("<button");
    expect(renderToStaticMarkup(<BrandMark />)).not.toContain("<a ");
  });
});

describe("作者署名链接", () => {
  it("写明作者，新窗口打开官方仓库，且不把本页交给外站", () => {
    const html = renderToStaticMarkup(<BrandCredit />);
    expect(html).toContain("chen guo tongxue");
    expect(html).toContain('href="https://github.com/c2247189334/ggtv-canvas"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("noopener");
  });
});
