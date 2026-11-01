import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { NodeProps } from "@xyflow/react";
import type { CardNode } from "@/types";
import { AudioCard } from "./AudioCard";

vi.mock("@xyflow/react", () => ({ SelectionMode: { Partial: "partial" }, useStore: (fn: (s: unknown) => unknown) => fn({ nodes: [], connection: {} }) }));
vi.mock("./boardContext", () => ({ useBoard: () => ({}) }));
vi.mock("./CardHandle", () => ({ CardHandle: ({ type }: { type: string }) => <span>{type}</span>, LineEnd: () => <span>line-end</span> }));
vi.mock("./CardTools", () => ({ CardTools: () => <span>下载预览</span> }));
vi.mock("@/library/worksEvents", () => ({ useDeletedWorks: () => new Set(["deleted"]) }));
const render = (id = "a", note: string | null = null) => renderToStaticMarkup(<AudioCard {...({ id: "a", selected: true,
  data: { kind: "audio", source: "extracted", number: 1, results: id ? [{ type: "work", id, media: "audio", seconds: 2 }] : [], page: 0, prompt: "", jobs: [], note } } as unknown as NodeProps<CardNode>)} />);
it("声音卡原生播放条隔离手势不自动播，只有右加号、左边只留来源线接点且没有生成面板", () => {
  const html = render();
  expect(html).toContain("音频 1 · 原声");
  expect(html).toContain("0:02");
  expect(html).toMatch(/<audio[^>]*class="[^"]*nodrag nowheel nopan[^"]*"[^>]*controls=""/);
  expect(html).not.toContain("autoPlay");
  expect(html).not.toContain("target");
  expect(html).toContain("line-end");
  expect(html).toContain("source");
  expect(html).not.toContain("textarea");
});
it("声音作品被删移除播放器，提取中与失败显示原话", () => {
  expect(render("deleted")).toContain("作品已删除");
  expect(render("deleted")).not.toContain("<audio");
  expect(render("", "提取中…")).toContain("提取中…");
  expect(render("", "提取原话")).toContain("提取原话");
});
