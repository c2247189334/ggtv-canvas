import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NodeProps } from "@xyflow/react";
import type { CardNode, VideoCardData } from "@/types";
import { DEFAULT_VIDEO_SETTINGS } from "@/domain/videoModels";
import { VideoCard, VideoFrame } from "./VideoCard";
import type { ReactElement } from "react";

vi.mock("@xyflow/react", () => ({
  Position: { Bottom: "bottom" }, SelectionMode: { Partial: "partial" },
  NodeToolbar: ({ align, children }: { align?: string; children?: ReactElement }) => <i data-toolbar-align={align ?? "center"}>{children}</i>,
  useStore: (selector: (state: unknown) => unknown) => selector({ nodes: [], connection: { inProgress: false } })
}));
vi.mock("./CardHandle", () => ({ CardHandle: () => null, LineEnd: () => <span>line-end</span> }));
vi.mock("./PromptPanel", () => ({ PromptPanel: () => null }));
vi.mock("@/canvas/boardContext", () => ({ useBoard: () => ({}) }));
vi.mock("@/library/worksEvents", () => ({ useDeletedWorks: () => new Set(["deleted"]) }));

const data: VideoCardData = { kind: "video", source: "generate", number: 2, results: [], page: 0, prompt: "", jobs: [], note: null, video: { ...DEFAULT_VIDEO_SETTINGS, count: 1 } };
const render = (patch: Partial<VideoCardData> = {}) => renderToStaticMarkup(<VideoCard {...({ id: "v", selected: false, data: { ...data, ...patch } } as NodeProps<CardNode>)} />);
describe("视频卡", () => {
  it('提前放出的视频卡显示正在拆解和转圈、不写时间（用户10-25定），失败原话和中断同源显示', () => {
    const patch = { rewriteId: 'r', rewriteSourceId: 's', rewriteBusy: 'analyzing' as const,
      rewriteStatus: { status: 'pending' as const } };
    const html = render(patch);
    expect(html).toContain('正在拆解'); expect(html).toContain('busy-spinner'); expect(html).not.toContain('已用');
    expect(html).toContain('card__busy');
    expect(render({ ...patch, rewriteBusy: undefined, rewriteStatus: { status: 'failed', error: '豆包失败原话', yuan: 0.02, costUnknown: false } })).toContain('豆包失败原话');
    expect(render({ ...patch, rewriteBusy: undefined, rewriteStatus: { status: 'interrupted' } })).toContain('上次没做完');
  });
  it('改写视频卡的提示词面板从卡左边往右展开，不挡左边一列；普通卡照旧居中（用户 10-30）', () => {
    expect(render({ rewriteId: 'r' })).toContain('data-toolbar-align="start"');
    expect(render()).toContain('data-toolbar-align="center"');
  });
  it("上传文件名用于卡片标题和视频名称", () => {
    const html = render({ source: "upload", number: 0, title: "source_10s.mp4", results: [{ type: "upload", id: "u", media: "video" }] });
    expect(html).toContain('<div class="card__title">source_10s.mp4</div>');
    expect(html).toContain('aria-label="source_10s.mp4"');
    expect(html).not.toContain("传的视频");
  });
  it("深度卡计算中转圈 +「正在生成中」和电脑配置说明、不写时间（用户10-31定），不显示生成面板", () => {
    const html = render({ source: "depth", depthJobId: "d", startedAt: new Date().toISOString() });
    expect(html).toContain("视频 2 · 深度");
    expect(html).toContain("正在生成中…");
    expect(html).toContain("生成速度取决于电脑配置");
    expect(html).toContain("busy-spinner");
    expect(html).not.toContain("已用");
    expect(html).toContain("line-end");
    expect(render({ source: "upload" })).not.toContain("line-end");
  });
  it('白模卡交单前就显示正在生成中并有来源线、不写已用时间（用户10-31定），失败后保留原话', () => {
    const html = render({ source: 'mesh', startedAt: new Date(Date.now() - 65_000).toISOString() });
    expect(html).toContain('视频 2 · 白模');
    expect(html).toContain('正在生成中…');
    expect(html).toContain('生成速度取决于电脑配置');
    expect(html).not.toContain('已用');
    expect(html).not.toContain('1:05');
    expect(html).toContain('line-end');
    const failed = render({ source: 'mesh', note: '白模失败原话', startedAt: undefined });
    expect(failed).toContain('白模失败原话');
    expect(failed).not.toContain('正在生成中…');
  });
  it('火山出视频写「正在生成中」和转圈，不写电脑配置（在火山上算，跟电脑无关）', () => {
    const html = render({ jobs: ['j'], phase: 'waiting' });
    expect(html).toContain('正在生成中…'); expect(html).toContain('busy-spinner');
    expect(html).not.toContain('电脑配置'); expect(html).not.toContain('火山生成中');
    expect(render({ jobs: ['j', 'k'], phase: 'waiting' })).toContain('正在生成中…（2 单）');
  });
  it("预览本体可选参考与Alt拖，只有播放控制时隔离手势", () => {
    const props = { url: "/v", title: "视频", playing: false, failure: null, missingText: "作品已删除", onStart: () => {}, onError: () => {}, onPlay: () => {}, onStop: () => {} };
    const preview = renderToStaticMarkup(<VideoFrame {...props} />);
    expect(preview).toMatch(/<video[^>]*class="card__video"/);
    expect(preview).not.toMatch(/<video[^>]*controls=""/);
    const playback = renderToStaticMarkup(<VideoFrame {...props} playing />);
    expect(playback).toMatch(/<video[^>]*class="card__video nodrag nowheel nopan"[^>]*controls=""/);
    const missing = renderToStaticMarkup(<VideoFrame {...props} failure="missing" />);
    expect(missing).toContain("作品已删除");
    expect(missing).not.toContain("<video");
  });
  it.each(["onPause", "onEnded"] as const)("%s 后画面恢复拖动，再播放时仍隔离播放条", event => {
    let playing = true;
    const props = { url: "/v", title: "视频", failure: null, missingText: "已删除", onStart: () => {}, onError: () => {},
      onPlay: () => { playing = true; }, onStop: () => { playing = false; } };
    const frame = () => VideoFrame({ ...props, playing });
    const video = (frame().props.children as ReactElement<Record<string, unknown>>[])[0];
    expect(video.props.className).toContain("nodrag");
    expect(video.props[event]).toBeTypeOf("function");
    (video.props[event] as () => void)();
    expect(renderToStaticMarkup(frame())).toMatch(/<video[^>]*class="card__video"/);
    props.onPlay();
    expect(renderToStaticMarkup(frame())).toMatch(/<video[^>]*class="card__video nodrag nowheel nopan"/);
  });
  it("空卡使用视频比例和提示", () => {
    const html = render({ video: { ...data.video, ratio: "9:16" } });
    expect(html).toContain("视频 2");
    expect(html).toContain("写提示词生成视频，或连图片 / 视频当参考");
    expect(html).toContain("aspect-ratio:9 / 16");
  });
  it("当前结果尺寸、播放按钮、时长及原生播放器隔离画布手势", () => {
    const html = render({ results: [{ type: "work", id: "v1", media: "video", seconds: 5, width: 720, height: 1280 }] });
    expect(html).toContain("<video");
    expect(html).toContain("nodrag nowheel nopan");
    expect(html).toContain("播放视频");
    expect(html).toContain("0:05");
    expect(html).toContain("aspect-ratio:720 / 1280");
  });
  it("忙时显示阶段，结束后原话可复制且不残留阶段", () => {
    expect(render({ jobs: ["j"], phase: "uploading" })).toContain("传参考视频…");
    const html = render({ phase: "waiting", note: "火山原话" });
    expect(html).toContain("火山原话");
    expect(html).not.toContain("正在生成中…");
    expect(html).toContain("card__note nodrag nowheel nopan");
  });
  it("被删作品显示已删除并移走播放器", () => {
    const html = render({ results: [{ type: "work", id: "deleted", media: "video" }] });
    expect(html).toContain("作品已删除");
    expect(html).not.toContain("<video");
  });
});
