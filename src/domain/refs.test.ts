import { describe, expect, it } from "vitest";
import { MAX_REFS, checkLink, dropLinkHint, linkId, reaches, refSources, type LinkEdge } from "./refs";

const edge = (source: string, target: string): LinkEdge => ({ id: linkId(source, target), source, target });

describe("dropLinkHint", () => {
  const base = { edges: [] as LinkEdge[], source: "a", target: "g", targetSource: "generate" as const };

  it("松手在空白处不提示", () => {
    expect(dropLinkHint({ ...base, target: null, targetSource: undefined })).toBeNull();
  });

  it("拖回自己身上不提示", () => {
    expect(dropLinkHint({ ...base, target: "a", targetSource: "upload" })).toBeNull();
  });

  it.each(["upload", "work"] as const)("拖到 %s 卡上说明只收进生成卡", (targetSource) => {
    expect(dropLinkHint({ ...base, targetSource })).toBe("传的图和作品库的图不收参考图，线要连进生成卡。");
  });

  it("允许的连线不提示", () => {
    expect(dropLinkHint(base)).toBeNull();
  });

  it("重复连线保留原来的原因", () => {
    expect(dropLinkHint({ ...base, edges: [edge("a", "g")] })).toBe("这两张卡已经连上了。");
  });

  it("参考图满了保留原来的原因", () => {
    const edges = Array.from({ length: MAX_REFS }, (_, i) => edge(`s${i}`, "g"));
    expect(dropLinkHint({ ...base, edges })).toBe("一张卡最多连 8 张参考图。");
  });

  it("绕圈保留原来的原因", () => {
    expect(dropLinkHint({ ...base, edges: [edge("g", "a")] })).toBe("这样连会绕成一个圈。");
  });
});

describe("refSources", () => {
  it("按连线先后排：先连的是 1", () => {
    const edges = [edge("b", "g"), edge("a", "g"), edge("a", "h")];
    expect(refSources(edges, "g")).toEqual(["b", "a"]);
  });
});

describe("reaches", () => {
  it("顺着线往下游走得到才算", () => {
    const edges = [edge("a", "b"), edge("b", "c")];
    expect(reaches(edges, "a", "c")).toBe(true);
    expect(reaches(edges, "c", "a")).toBe(false);
  });
});

describe("checkLink", () => {
  const base = { edges: [] as LinkEdge[], source: "a", target: "g", targetSource: "generate" as const };

  it("连进生成卡可以", () => {
    expect(checkLink(base)).toEqual({ ok: true });
  });

  it("不能自己连自己", () => {
    expect(checkLink({ ...base, target: "a" })).toMatchObject({ ok: false });
  });

  it("传的图不收参考图", () => {
    const r = checkLink({ ...base, targetSource: "upload" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("生成卡");
  });

  it("已经连过的不重复连", () => {
    expect(checkLink({ ...base, edges: [edge("a", "g")] })).toMatchObject({ ok: false });
  });

  it(`最多 ${MAX_REFS} 张`, () => {
    const edges = Array.from({ length: MAX_REFS }, (_, i) => edge(`s${i}`, "g"));
    const r = checkLink({ ...base, edges });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("8");
  });

  it("不能绕成圈", () => {
    const r = checkLink({ ...base, source: "g2", target: "g", edges: [edge("g", "g2")] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("圈");
  });
});
