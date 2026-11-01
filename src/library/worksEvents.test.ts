import { describe, expect, it } from "vitest";
import { bumpWorks, isWorkDeleted, markWorkDeleted, worksVersion } from "./worksEvents";

describe("worksEvents", () => {
  it("删掉的作品记下来，版本号加 1", () => {
    const before = worksVersion();
    markWorkDeleted("w1");
    expect(isWorkDeleted("w1")).toBe(true);
    expect(isWorkDeleted("w2")).toBe(false);
    expect(worksVersion()).toBe(before + 1);
  });

  it("有新作品时版本号加 1（作品库侧栏靠它重新拉清单）", () => {
    const before = worksVersion();
    bumpWorks();
    expect(worksVersion()).toBe(before + 1);
  });
});
