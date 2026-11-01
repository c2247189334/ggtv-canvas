import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorksSidebar } from "./WorksSidebar";
import { WorksGrid } from "./WorksGrid";

// 静态渲染没有外部订阅环境；作品计数不影响这句提示的实际渲染。
vi.mock("./worksEvents", () => ({ useWorksVersion: () => 0 }));

it("作品库有声音筛选并提示图片视频声音都能拖入画布", () => {
  const html = renderToStaticMarkup(<WorksSidebar canvasId="c" onClose={() => {}} openViewer={() => {}} notify={() => {}} />);
  expect(html).toContain(">声音</button>");
  expect(html).toContain("把图片、视频或声音拖进画布就能接着用。");
});

it("作品库筛选按 图片 / 视频 / 声音 / 全部 排，默认选中图片", () => {
  const html = renderToStaticMarkup(<WorksSidebar canvasId="c" onClose={() => {}} openViewer={() => {}} notify={() => {}} />);
  const buttons = [...html.matchAll(/<button type="button" class="(is-on)?">([^<]+)<\/button>/g)].map(([, on, label]) => on ? `[${label}]` : label);
  expect(buttons).toEqual(["[图片]", "视频", "声音", "全部"]);
});

it("作品库空时说图视频和声音都会进来", () => {
  const html = renderToStaticMarkup(<WorksGrid works={[]} onOpen={() => {}} />);
  expect(html).toContain("图片、视频和提取的声音会自动出现在这里。");
});
