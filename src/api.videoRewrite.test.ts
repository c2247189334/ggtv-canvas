import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("改写错误保留原话和状态码", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "第二轮失败", yuan: 0.012 }), { status: 502 })));
  await expect(api.analyzeVideo({ cardId: "r", source: { type: "upload", id: "v" }, userText: "换人物" }))
    .rejects.toMatchObject({ message: "第二轮失败", status: 502 });
});

it("免费检查使用约定路径，检查请求带上变化秒数", async () => {
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ issues: [], yuan: 0 })));
  vi.stubGlobal("fetch", fetcher);
  const check = { cardId: "r-1", videoPrompt: "0-6秒：人物。", duration: 6, materials: [], changeSeconds: [2.5] };
  await expect(api.checkVideoPrompt(check)).resolves.toEqual({ issues: [], yuan: 0 });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/video-rewrite/check"]);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify(check) });
});

