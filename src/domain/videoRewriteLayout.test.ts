import { expect, it } from "vitest";
import { measuredRewriteColumn } from "./videoRewriteLayout";
import { newAudioCard, newVideoCard, newCard } from "./cards";
import type { CardNode } from "@/types";

function column(depthHeight = 519, hasAudio = true): CardNode[] {
  return [
    { id: "depth", type: "card", position: { x: 380, y: 160 }, measured: { width: 280, height: depthHeight }, data: newVideoCard("depth", 2) },
    ...(hasAudio ? [{ id: "audio", type: "card" as const, position: { x: 380, y: 738 }, measured: { width: 280, height: 205 }, data: newAudioCard("extracted", 3) }] : []),
    { id: "rewrite", type: "card", position: { x: 380, y: 908 }, measured: { width: 280, height: 321 },
      data: newCard('upload', 1) }
  ];
}
const args = (nodes: CardNode[]) => ({ ids: nodes.map(n => n.id), movableIds: nodes.map(n => n.id), origin: { x: 380, y: 160 } });

it.each([[519, true], [180, true], [519, false], [180, false]] as const)("真实高度%s、有声%s：竖横屏三张逐一相隔40且不重叠", (height, audio) => {
  const nodes = column(height, audio);
  const packed = measuredRewriteColumn(nodes, args(nodes))!;
  expect(packed).not.toBeNull();
  expect(packed[0].position).toEqual({ x: 380, y: 160 });
  for (let i = 1; i < packed.length; i++) {
    expect(packed[i].position.y - packed[i - 1].position.y - packed[i - 1].measured!.height!).toBe(40);
  }
  expect(measuredRewriteColumn(packed, args(packed))).toBe(packed);
});
it("没收到真实尺寸就等待，不拿预估高度替代", () => {
  const nodes = column(); nodes[1] = { ...nodes[1], measured: undefined };
  expect(measuredRewriteColumn(nodes, args(nodes))).toBeNull();
});
it("已有深度/原声位置不动，新卡按它们的真实边界避让", () => {
  const nodes = column();
  const packed = measuredRewriteColumn(nodes, { ...args(nodes), movableIds: ["rewrite"] })!;
  expect(packed[0]).toBe(nodes[0]); expect(packed[1]).toBe(nodes[1]);
  expect(packed[2].position.y).toBe(738 + 205 + 40);
});
it("真实高度变化后重新排列；同列其它卡按真实边界避让", () => {
  const nodes = column();
  const blocker: CardNode = { ...nodes[0], id: "blocker", position: { x: 380, y: 100 }, measured: { width: 280, height: 1000 } };
  const packed = measuredRewriteColumn([...nodes, blocker], args(nodes))!;
  expect(packed[0].position.y).toBe(1140);
  const resized = packed.map(n => n.id === "audio" ? { ...n, measured: { width: 280, height: 260 } } : n);
  const again = measuredRewriteColumn(resized, args(nodes))!;
  expect(again[2].position.y - again[1].position.y - 260).toBe(40);
});
