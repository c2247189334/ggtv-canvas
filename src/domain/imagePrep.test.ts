import { describe, expect, it, vi } from "vitest";
import { MAX_UPLOAD_EDGE, fitWithin, prepareUpload } from "./imagePrep";

describe("fitWithin", () => {
  it("本来就够小原样返回", () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("长边缩到 1600，比例不变", () => {
    expect(MAX_UPLOAD_EDGE).toBe(1600);
    expect(fitWithin({ width: 4000, height: 3000 })).toEqual({ width: 1600, height: 1200 });
  });
});

// 11-14 体检：透明底 PNG（抠好的衣服 / 商品图）转 JPG 前没铺底色，透明的地方会变成黑的。
describe("prepareUpload", () => {
  it("要转成 JPG 的图先铺白底再画，透明的地方不会变黑", async () => {
    const steps: string[] = [];
    const context = {
      fillStyle: "",
      fillRect(x: number, y: number, width: number, height: number) { steps.push(`fill ${this.fillStyle} ${x},${y},${width},${height}`); },
      drawImage() { steps.push("draw"); },
    };
    const canvas = { width: 0, height: 0, getContext: () => context, toBlob: (done: (blob: Blob) => void) => done(new Blob(["jpg"], { type: "image/jpeg" })) };
    class FakeImage {
      naturalWidth = 3200; naturalHeight = 1600; onload = () => {}; onerror = () => {};
      set src(_url: string) { queueMicrotask(() => this.onload()); }
    }
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", { createElement: () => canvas });
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake");
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    try {
      const result = await prepareUpload(new File(["png"], "衣服.png", { type: "image/png" }));
      expect(steps).toEqual(["fill #ffffff 0,0,1600,800", "draw"]);
      expect(result.type).toBe("image/jpeg");
      expect(result.name).toBe("衣服.jpg");
    } finally {
      vi.unstubAllGlobals(); create.mockRestore(); revoke.mockRestore();
    }
  });
});
