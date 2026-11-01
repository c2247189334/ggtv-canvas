import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { CardTools } from "./CardTools";
import { DepthChoices, MeshChoices } from './LocalMediaTools';

const opened: unknown[][] = [];
vi.mock("@xyflow/react", () => ({ Position: { Top: "top" }, NodeToolbar: ({ children }: { children: ReactNode }) => children }));
vi.mock("./boardContext", () => ({ useBoard: () => ({ openViewer: (...args: unknown[]) => opened.push(args) }) }));

it("卡上方工具条只有下载和预览；下载带 download=1，预览按媒体类型打开", () => {
  const html = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "u1" }} title="视频 2" media="video" />);
  expect(html).toContain('href="/api/uploads/file?id=u1&amp;download=1"');
  expect(html).toContain(">下载<");
  expect(html).toContain(">预览<");
  expect(html.replace(/<[^>]*>/g, "")).toBe("下载预览");

  const tree = CardTools({ asset: { type: "work", id: "w1" }, title: "图片 1", media: "image" }) as { props: { children: { props: { children: Array<{ props: { onClick?: () => void } }> } } } };
  tree.props.children.props.children[1].props.onClick?.();
  expect(opened).toEqual([["/api/works/file?id=w1", "图片 1", "image"]]);
});

it("视频附加本机工具，声音仍只有下载和预览", () => {
  const video = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "v", media: "video", hasAudio: false }} title="视频 1" media="video" cardId="v" />);
  expect(video).toContain("深度动作捕捉");
  expect(video).toContain('白模动作捕捉');
  expect(video.indexOf('深度动作捕捉')).toBeLessThan(video.indexOf('白模动作捕捉'));
  expect(video).toMatch(/disabled=""[^>]*title="这段视频没有声音"/);
  expect(video).toContain("提取原声");
  const depth = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "d", depth: true }} title="视频 2 · 深度" media="video" cardId="d" />);
  expect(depth).not.toContain("深度动作捕捉");
  const audio = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "a", media: "audio" }} title="音频 1" media="audio" />);
  expect(audio.replace(/<[^>]*>/g, "")).toBe("下载预览");
});

it('白模浮层只确认提取不选清晰度，白模结果和深度一样不提供重复提取入口', () => {
  const html = renderToStaticMarkup(<MeshChoices busy={false} onConfirm={() => {}} />);
  expect(html).toContain('白模动作捕捉');
  expect(html).toContain('本机计算，生成时间取决于电脑配置');
  expect(html).not.toContain('分钟');
  const depth = renderToStaticMarkup(<DepthChoices resolution="480p" onChange={() => {}} busy={false} onConfirm={() => {}} />);
  expect(depth).toContain('本机计算，生成时间取决于电脑配置');
  expect(html).toContain('确认提取');
  expect(html).not.toMatch(/480P|720P/);
  const mesh = renderToStaticMarkup(<CardTools asset={{ type: 'work', id: 'mesh', mesh: true }} title="白模" media="video" cardId="mesh" />);
  expect(mesh).not.toContain('白模动作捕捉');
  expect(mesh).not.toContain('视频改写');
});

it("预览入口把上传文件名原样交给查看层", () => {
  opened.length = 0;
  const tree = CardTools({ asset: { type: "upload", id: "v", media: "video" }, title: "source_10s.mp4", media: "video" }) as { props: { children: { props: { children: Array<{ props: { onClick?: () => void } }> } } } };
  tree.props.children.props.children[1].props.onClick?.();
  expect(opened).toEqual([["/api/uploads/file?id=v", "source_10s.mp4", "video"]]);
});

it("原视频卡提供视频改写入口，深度卡不提供", () => {
  const video = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "v", media: "video", seconds: 6 }} title="源视频" media="video" cardId="v" />);
  expect(video).toContain(">视频改写<");
  const depth = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "d", depth: true }} title="深度" media="video" cardId="d" />);
  expect(depth).not.toContain("视频改写");
});

it('片段截取在原声后改写前，短于1秒禁用，深度和无cardId无入口', () => {
  const render = (seconds: number, depth = false, cardId: string | undefined = 'v') => renderToStaticMarkup(
    <CardTools asset={{ type: 'upload', id: 'v', media: 'video', seconds, depth }} title="视频" media="video" cardId={cardId} />);
  const html = render(9);
  expect(html).toContain('aria-label="片段截取"');
  expect(html.indexOf('提取原声')).toBeLessThan(html.indexOf('片段截取'));
  expect(html.indexOf('片段截取')).toBeLessThan(html.indexOf('视频改写'));
  expect(render(0.9)).toMatch(/<button[^>]*disabled=""[^>]*title="视频不到 1 秒，不能截取"[^>]*>片段截取/);
  expect(render(9, true)).not.toContain('片段截取');
  expect(renderToStaticMarkup(<CardTools asset={{ type: 'upload', id: 'v' }} title="视频" media="video" />)).not.toContain('片段截取');
});
