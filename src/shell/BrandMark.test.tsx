import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BrandMark } from "./BrandMark";

describe("左上 GG TV 标志", () => {
  it("读屏念 GG TV，只有 G G T V 四个字形、不带外圈和碎片", () => {
    const html = renderToStaticMarkup(<BrandMark />);
    expect(html).toContain('aria-label="GG TV"');
    expect(html.match(/<path /g)).toHaveLength(4);
    expect(html).not.toContain("<circle");
  });

  it("只展示，不是能点的按钮", () => {
    expect(renderToStaticMarkup(<BrandMark />)).not.toContain("<button");
  });
});
