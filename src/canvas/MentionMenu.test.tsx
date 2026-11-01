import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MentionMenu } from "./MentionMenu";

describe("MentionMenu", () => {
  it("音频分组用音符和时长，不渲染成图片或视频", () => {
    const html = renderToStaticMarkup(<MentionMenu grouped refs={[
      { sourceId: "a", number: 1, media: "audio", seconds: 2, url: "/audio/a", title: "原声" }
    ]} onSelect={() => {}} />);
    expect(html).toContain("<h3>音频</h3>"); expect(html).toContain("音频1");
    expect(html).toContain("♪ 0:02"); expect(html).not.toContain("<img"); expect(html).not.toContain("<video");
  });
  it.each([false, true])("没有素材时给出统一说明 grouped=%s", grouped => {
    const html = renderToStaticMarkup(<MentionMenu grouped={grouped} refs={[]} onSelect={() => {}} />);
    expect(html).toContain("素材引用");
    expect(html).toContain("暂无可引用资产，请连入后操作");
  });
  it("列出每张参考图的缩略图及编号，暂无结果的连线也保留编号", () => {
    const html = renderToStaticMarkup(<MentionMenu refs={[
      { sourceId: "a", number: 1, url: "/image/a", title: "猫" },
      { sourceId: "b", number: 2, url: null, title: "草稿" }
    ]} onSelect={() => {}} />);
    expect(html).toContain('src="/image/a"');
    expect(html).toContain("图片1");
    expect(html).toContain("图片2");
    expect(html).toContain("还没图");
  });
  it("视频面板分图片和视频两组，各自编号，未出结果仍显示视频编号", () => {
    const html = renderToStaticMarkup(<MentionMenu grouped refs={[
      { sourceId: "a", number: 1, media: "video", seconds: 5, url: "/video/a", title: "视频" },
      { sourceId: "b", number: 1, media: "image", url: "/image/b", title: "图" },
      { sourceId: "c", number: 2, media: "video", url: null, title: "草稿" }
    ]} onSelect={() => {}} />);
    expect(html).toContain("<h3>图片</h3>");
    expect(html).toContain("<h3>视频</h3>");
    expect(html).toContain("视频1");
    expect(html).toContain("视频2");
    expect(html).toContain("图片1");
    expect(html).toContain("<video");
    expect(html).toContain("0:05");
    expect(html).toContain("还没视频");
  });
});
