// 11-12「我上传的」拖进画布：空白处新建上传卡（原文件名当标题），拖到改写图片卡上按上传素材补图。
import { expect, it, vi } from "vitest";
import { newCard } from "@/domain/cards";
import { uploadDragData } from "@/domain/uploads";
import { patchCard } from "@/domain/sendRefs";
import type { CardNode, ImageCardData } from "@/types";

vi.mock("./uploadMedia", () => ({ uploadMedia: vi.fn() }));
vi.mock("@/common/pickFiles", () => ({ pickFiles: vi.fn() }));
const { handleCanvasDrop } = await import("./RewriteImageUpload");

const video = { id: "v1", kind: "video" as const, name: "跳舞.mp4", duration: 5, width: 720, height: 1280, hasAudio: true, fps: 30, createdAt: "t", uploadedAt: "t", canvases: [] };
const image = { id: "i1", kind: "image" as const, name: "猫.png", createdAt: "t", uploadedAt: "t", canvases: [] };

it("空白处放下：建上传卡、带原文件名，不当成作品", async () => {
  const board = { notify: vi.fn(), addAssets: vi.fn(), dropFiles: vi.fn(), updateCard: vi.fn() };
  await handleCanvasDrop([], null, { work: uploadDragData(video), files: [] }, { x: 1, y: 2 }, board);
  expect(board.addAssets).toHaveBeenCalledExactlyOnceWith("upload",
    [{ type: "upload", id: "v1", media: "video", seconds: 5, width: 720, height: 1280, hasAudio: true, fps: 30, fileName: "跳舞.mp4" }], { x: 1, y: 2 });
});

it("拖到改写图片卡上：追加上传素材，不带文件名进结果", async () => {
  const node: CardNode = { id: "r", type: "card", position: { x: 0, y: 0 }, selected: false,
    data: { ...newCard("generate", 1, []), rewriteId: "rw" } };
  let nodes = [node];
  const board = { notify: vi.fn(), addAssets: vi.fn(), dropFiles: vi.fn(),
    updateCard: vi.fn((id: string, patch) => { nodes = nodes.map(n => n.id === id ? { ...n, data: patchCard(n.data, patch) } : n); }) };
  await handleCanvasDrop(nodes, "r", { work: uploadDragData(image), files: [] }, { x: 0, y: 0 }, board, () => nodes);
  expect(board.addAssets).not.toHaveBeenCalled();
  expect((nodes[0].data as ImageCardData).results).toEqual([{ type: "upload", id: "i1" }]);
});
