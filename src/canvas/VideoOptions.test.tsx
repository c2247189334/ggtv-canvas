import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VideoOptions, VideoOptionChoices, VideoModelMenu, VideoModeMenu } from "./VideoOptions";
import { DEFAULT_VIDEO_SETTINGS, VIDEO_MODELS } from "@/domain/videoModels";
import { videoEstimate } from "@/domain/videoPanel";
import type { VideoGenSettings } from "@/types";

const settings: VideoGenSettings = { ...DEFAULT_VIDEO_SETTINGS, count: 1 };
describe("视频选项", () => {
  it("底行短模型名、文生视频、合并设置和总估价，问题会锁发送", () => {
    const video = { ...settings, ratio: "adaptive" as const, count: 4 as const };
    const html = renderToStaticMarkup(<VideoOptions video={video} refs={[]} sending={false} disabled onChange={() => {}} onSend={() => {}} />);
    expect(html).toContain("2.0 Mini");
    expect(html).toContain("文生视频");
    expect(html).toContain("Auto · 480P · 5s · 4个");
    expect(html).toContain(`¥${videoEstimate(video, []).yuan.toFixed(2)}`);
    expect(html).toMatch(/class="gen__send" disabled=""/);
  });
  it("设置按比例、清晰度、时长、音频、数量排序，2.5 首帧只可 Auto", () => {
    const html = renderToStaticMarkup(<VideoOptionChoices video={{ ...settings, model: VIDEO_MODELS[3].id, mode: "first_frame", ratio: "adaptive" }} onChange={() => {}} />);
    for (const [before, after] of [["比例", "清晰度"], ["清晰度", "视频时长"], ["视频时长", "生成音频"], ["生成音频", "生成数量"]]) expect(html.indexOf(before)).toBeLessThan(html.indexOf(after));
    expect(html).toContain('max="30"');
    expect(html).toContain('type="range"');
    expect(html).toContain('type="number"');
    expect(html).toContain('disabled=""');
    expect(html).toContain("1080P");
    expect(html).toContain("4个");
  });
  it("模型列全名，切模型纠正设置且保留数量", () => {
    let changed = settings;
    const menu = VideoModelMenu({ video: { ...settings, model: VIDEO_MODELS[3].id, resolution: "1080p", duration: 30, count: 4 }, onChange: next => { changed = next; }, onClose: () => {} });
    expect(renderToStaticMarkup(menu)).toContain("Seedance 2.0 Fast");
    menu.props.children[0].props.onClick();
    expect(changed).toMatchObject({ model: VIDEO_MODELS[0].id, resolution: "720p", duration: 15, count: 4 });
  });
  it("模式只有全能参考和图生视频，切换会纠正 2.5 首帧比例", () => {
    let changed = settings;
    const menu = VideoModeMenu({ video: { ...settings, model: VIDEO_MODELS[3].id }, onChange: next => { changed = next; }, onClose: () => {} });
    expect(renderToStaticMarkup(menu)).toContain("视频生成模式");
    menu.props.children[1].props.children[1].props.onClick();
    expect(changed).toMatchObject({ mode: "first_frame", ratio: "adaptive", count: 1 });
  });
});
