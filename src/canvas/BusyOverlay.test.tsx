import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyOverlay } from "./BusyOverlay";

it("生成中只转圈 + 一句话、不写时间；本机算的多一行电脑配置说明（用户 10-31 定）", () => {
  const cloud = renderToStaticMarkup(<BusyOverlay text="正在生成中…" />);
  expect(cloud).toContain("busy-spinner"); expect(cloud).toContain("正在生成中…");
  expect(cloud).not.toContain("电脑配置"); expect(cloud).not.toMatch(/\d:\d\d/);
  const local = renderToStaticMarkup(<BusyOverlay text="正在生成中…" local />);
  expect(local).toContain("生成速度取决于电脑配置"); expect(local).not.toContain("已用");
});

it("本机算的给了停止就显示「停止」按钮，火山的不显示", () => {
  const local = renderToStaticMarkup(<BusyOverlay text="正在生成中…" local onStop={() => {}} />);
  expect(local).toContain(">停止</button>"); expect(local).toContain("nodrag");
  expect(renderToStaticMarkup(<BusyOverlay text="正在生成中…" local />)).not.toContain("停止");
  expect(renderToStaticMarkup(<BusyOverlay text="排队中" />)).not.toContain("停止");
});
