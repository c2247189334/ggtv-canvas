import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UploadsGrid } from "./UploadsGrid";

it("「我上传的」空时说清楚会留什么；格子写原文件名，视频带时长", () => {
  expect(renderToStaticMarkup(<UploadsGrid items={[]} onOpen={() => {}} />)).toContain("从电脑传的图片和视频会自动留在这里。");
  const html = renderToStaticMarkup(<UploadsGrid onOpen={() => {}} items={[
    { id: "v", kind: "video", name: "跳舞.mp4", duration: 5, createdAt: "t", uploadedAt: "t", canvases: [] },
    { id: "i", kind: "image", name: "猫.png", createdAt: "t", uploadedAt: "t", canvases: [] }]} />);
  expect(html).toContain('<span class="works__name">跳舞.mp4</span>');
  expect(html).toContain('src="/api/uploads/file?id=v#t=0.001"');
  expect(html).toContain('src="/api/uploads/file?id=i"');
});
