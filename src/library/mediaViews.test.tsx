import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorksGrid } from "./WorksGrid";
import { AudioPreview, ImagePreview, VideoPreview } from "@/common/ImageViewer";
import { assetMenuItems } from "@/domain/menus";
import { newCard, newVideoCard } from "@/domain/cards";
import type { AudioWorkView, WorkView } from "@/types";

describe("视频作品和大图内容", () => {
  const work: WorkView = { id: "v", kind: "video", duration: 5, width: 320, height: 180, createdAt: "", canvasId: null, prompt: "测试", model: "", yuan: 0 };
  it("视频网格第一帧、播放标志和时长，拖入携带媒体元数据", () => {
    const html = renderToStaticMarkup(<WorksGrid works={[work]} onOpen={() => {}} draggable />);
    expect(html).toContain("<video");
    expect(html).toContain("▶");
    expect(html).toContain("0:05");
    const writes: Record<string, string> = {};
    const tree = WorksGrid({ works: [work], onOpen: () => {}, draggable: true });
    tree.props.children[0].props.onDragStart({ dataTransfer: { setData: (key: string, text: string) => { writes[key] = text; } } });
    expect(JSON.parse(Object.values(writes)[0])).toMatchObject({ id: "v", kind: "video", duration: 5, width: 320, height: 180 });
  });
  it("声音网格以音符和时长预览，拖入包含真实声音时长", () => {
    const audio: AudioWorkView = { ...work, kind: "audio", duration: 5, format: "wav", contentType: "audio/wav", channels: 1, sampleRate: 44100, bitsPerSample: 16, bytes: 100 };
    const opened: string[] = [];
    const html = renderToStaticMarkup(<WorksGrid works={[audio]} onOpen={w => opened.push(w.id)} draggable />);
    expect(html).toContain("♪");
    expect(html).toContain("0:05");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<video");
    const tree = WorksGrid({ works: [audio], onOpen: w => opened.push(w.id), draggable: true });
    const tile = tree.props.children[0];
    const writes: Record<string, string> = {};
    tile.props.onDragStart({ dataTransfer: { setData: (key: string, value: string) => { writes[key] = value; } } });
    expect(JSON.parse(Object.values(writes)[0])).toMatchObject({ id: "v", kind: "audio", duration: 5 });
    tile.props.children[0].props.children[0].props.onClick();
    expect(opened).toEqual(["v"]);
  });
  it("深度视频在网格标记深度，普通视频没有", () => {
    expect(renderToStaticMarkup(<WorksGrid works={[{ ...work, depth: true }]} onOpen={() => {}} />)).toContain("深度");
    expect(renderToStaticMarkup(<WorksGrid works={[work]} onOpen={() => {}} />)).not.toContain("深度");
  });
  it('白模作品带同样式的白模标记，拖入保留种类', () => {
    const html = renderToStaticMarkup(<WorksGrid works={[{ ...work, mesh: true }]} onOpen={() => {}} draggable />);
    expect(html).toContain('class="works__depth">白模');
    const tree = WorksGrid({ works: [{ ...work, mesh: true }], onOpen: () => {}, draggable: true });
    let payload = '';
    tree.props.children[0].props.onDragStart({ dataTransfer: { setData: (_key: string, value: string) => { payload = value; } } });
    expect(JSON.parse(payload)).toMatchObject({ mesh: true });
  });
  it("视频拖入保留声音、帧率和深度标记", () => {
    for (const metadata of [{ hasAudio: false, fps: 30, depth: true }, { hasAudio: true, fps: 24, depth: false }]) {
      const tree = WorksGrid({ works: [{ ...work, ...metadata }], onOpen: () => {}, draggable: true });
      let payload = "";
      tree.props.children[0].props.onDragStart({ dataTransfer: { setData: (_key: string, value: string) => { payload = value; } } });
      expect(JSON.parse(payload)).toMatchObject(metadata);
    }
  });
  // 视频预览顶栏写名字 + 关闭（Esc），不自动播放；图片预览没有标题，角上一个关闭钮。
  it("视频预览顶栏有名字和关闭，原生有声播放器但不自动播放", () => {
    const html = renderToStaticMarkup(<VideoPreview url="/video" title="视频 2" onClose={() => {}} />);
    expect(html).toMatch(/<video[^>]*controls=""/);
    expect(html).not.toContain("autoPlay");
    expect(html).not.toContain("muted");
    expect(html).toContain("视频 2");
    expect(html).toContain("关闭（Esc）");
  });
  it("图片预览只有图和角上的关闭钮，不显示标题文字", () => {
    const html = renderToStaticMarkup(<ImagePreview url="/image" title="一只猫" onClose={() => {}} />);
    expect(html).toContain('<img class="viewer__image"');
    expect(html).toContain('aria-label="关闭（Esc）"');
    expect(html.replace(/<[^>]*>/g, "")).toBe("×");
  });
  it("声音预览整屏黑底、顶栏名字和播放条，不自动播放", () => {
    const html = renderToStaticMarkup(<AudioPreview url="/audio" title="声音 2" onClose={() => {}} />);
    expect(html).toContain("viewer--audio");
    expect(html).toMatch(/<audio[^>]*controls=""/);
    expect(html).not.toContain("autoPlay");
    expect(html).toContain("声音 2");
    expect(html).toContain("关闭（Esc）");
  });
});

describe("真人素材菜单", () => {
  const action = () => {};
  it("仅传图与作品图允许填、改和清除，生成图和视频不提供", () => {
    expect(assetMenuItems(newCard("upload", 1), action, action)).toEqual([{ label: "填真人素材编号…", onSelect: action }]);
    expect(assetMenuItems({ ...newCard("work", 1), assetId: "person" }, action, action)).toEqual([
      { label: "改真人素材编号…", onSelect: action }, { label: "清除真人素材编号", onSelect: action }
    ]);
    expect(assetMenuItems(newCard("generate", 1), action, action)).toEqual([]);
    expect(assetMenuItems(newVideoCard("upload", 1), action, action)).toEqual([]);
  });
});
