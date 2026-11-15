import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { markSaveConflict } from "@/domain/saveConflicts";
import { SaveConflictBanner } from "./SaveConflictBanner";

it("画布存档冲突后一直挂着提醒：说清之后的改动不会保存，给刷新按钮", () => {
  markSaveConflict("banner-conflicted");
  const html = renderToStaticMarkup(<SaveConflictBanner canvasId="banner-conflicted" onReload={vi.fn()} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("这张画布在别的页面改过了，这一页之后的改动都不会保存");
  expect(html).toMatch(/<button[^>]*>刷新页面<\/button>/);
});

it("没冲突的画布不显示提醒", () => {
  expect(renderToStaticMarkup(<SaveConflictBanner canvasId="banner-clean" onReload={vi.fn()} />)).toBe("");
});
