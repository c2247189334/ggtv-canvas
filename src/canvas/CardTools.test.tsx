import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { CardTools } from "./CardTools";
import { DepthChoices, MeshChoices, VideoMoreItems } from './LocalMediaTools';

const opened: unknown[][] = [];
vi.mock("@xyflow/react", () => ({ Position: { Top: "top" }, NodeToolbar: ({ children }: { children: ReactNode }) => children }));
vi.mock("./boardContext", () => ({ useBoard: () => ({ openViewer: (...args: unknown[]) => opened.push(args) }) }));

type El = { props?: { children?: unknown; onClick?: () => void; 'aria-label'?: string } };
/** 在没渲染的元素树里按 aria-label 找按钮（不展开子组件）。 */
const find = (node: unknown, label: string): El | undefined => {
  if (!node || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) return node.map(child => find(child, label)).find(Boolean);
  const element = node as El;
  return element.props?.['aria-label'] === label ? element : find(element.props?.children, label);
};
const text = (html: string) => html.replace(/<[^>]*>/g, "");
const noop = () => {};

it("11-08 用户定：下载、预览是最右两个小图标；下载带 download=1，预览按媒体类型打开", () => {
  const html = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "u1" }} title="视频 2" media="video" />);
  expect(html).toContain('href="/api/uploads/file?id=u1&amp;download=1"');
  expect(html).toMatch(/aria-label="下载"[^>]*title="下载"/);
  expect(html).toMatch(/aria-label="预览"[^>]*title="预览"/);
  expect(html.indexOf('aria-label="下载"')).toBeLessThan(html.indexOf('aria-label="预览"'));
  expect(text(html)).toBe("");
  expect(html).not.toContain('card-tools__sep');

  find(CardTools({ asset: { type: "work", id: "w1" }, title: "图片 1", media: "image" }), "预览")?.props?.onClick?.();
  expect(opened).toEqual([["/api/works/file?id=w1", "图片 1", "image"]]);
});

it("原视频卡左边依次「视频改写 / 拆解（无人物）/ 更多 ▾」，竖线后才是图标；深度、白模、原声、截取不摆在外面", () => {
  const video = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "v", media: "video", hasAudio: false }} title="视频 1" media="video" cardId="v" />);
  const order = [">视频改写<", ">拆解（无人物）<", ">更多 ▾<", "card-tools__sep", 'aria-label="下载"', 'aria-label="预览"'].map(part => video.indexOf(part));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(video).toMatch(/aria-haspopup="menu" aria-expanded="false"/);
  for (const hidden of ["深度动作捕捉", "白模动作捕捉", "提取原声", "片段截取"]) expect(video).not.toContain(hidden);
  const depth = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "d", depth: true }} title="视频 2 · 深度" media="video" cardId="d" />);
  expect(text(depth)).toBe("");
  const audio = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "a", media: "audio" }} title="音频 1" media="audio" />);
  expect(text(audio)).toBe("");
  expect(audio).toContain('aria-label="下载"');
});

it("「更多」里四项：深度、白模、提取原声、片段截取；没声音、不到 1 秒各自禁用并写原因", () => {
  const html = renderToStaticMarkup(<VideoMoreItems asset={{ type: "upload", id: "v", media: "video", seconds: 9 }} busy={false}
    onDepth={noop} onMesh={noop} onAudio={noop} onClip={noop} />);
  const order = ["深度动作捕捉", "白模动作捕捉", "提取原声", "片段截取"].map(name => html.indexOf(`>${name}<`));
  expect(order.every(index => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  expect(html).toContain('aria-label="片段截取"');
  expect(html).not.toContain('disabled=""');
  const limited = renderToStaticMarkup(<VideoMoreItems asset={{ type: "upload", id: "v", media: "video", seconds: 0.9, hasAudio: false }} busy={false}
    onDepth={noop} onMesh={noop} onAudio={noop} onClip={noop} />);
  expect(limited).toMatch(/disabled=""[^>]*title="这段视频没有声音"/);
  expect(limited).toMatch(/<button[^>]*disabled=""[^>]*title="视频不到 1 秒，不能截取"[^>]*>片段截取/);
  const busy = renderToStaticMarkup(<VideoMoreItems asset={{ type: "upload", id: "v", media: "video", seconds: 9 }} busy
    onDepth={noop} onMesh={noop} onAudio={noop} onClip={noop} />);
  expect(busy.match(/disabled=""/g)).toHaveLength(3);
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
  expect(mesh).not.toContain('更多');
  expect(mesh).not.toContain('视频改写');
});

it("预览入口把上传文件名原样交给查看层", () => {
  opened.length = 0;
  find(CardTools({ asset: { type: "upload", id: "v", media: "video" }, title: "source_10s.mp4", media: "video" }), "预览")?.props?.onClick?.();
  expect(opened).toEqual([["/api/uploads/file?id=v", "source_10s.mp4", "video"]]);
});

it("原视频卡提供视频改写入口，深度卡和没有 cardId 的视频不提供", () => {
  const video = renderToStaticMarkup(<CardTools asset={{ type: "upload", id: "v", media: "video", seconds: 6 }} title="源视频" media="video" cardId="v" />);
  expect(video).toContain(">视频改写<");
  const depth = renderToStaticMarkup(<CardTools asset={{ type: "work", id: "d", depth: true }} title="深度" media="video" cardId="d" />);
  expect(depth).not.toContain("视频改写");
  expect(renderToStaticMarkup(<CardTools asset={{ type: 'upload', id: 'v' }} title="视频" media="video" />)).not.toContain('更多');
});
