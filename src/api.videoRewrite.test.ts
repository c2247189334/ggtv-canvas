import { afterEach, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => vi.unstubAllGlobals());

it("付费改写错误保留原话和已确认金额，未知费用不能丢", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "第二轮失败", yuan: 0.012, costUnknown: true }), { status: 502 })));
  await expect(api.analyzeVideo({ cardId: "r", source: { type: "upload", id: "v" }, userText: "换人物" }))
    .rejects.toMatchObject({ message: "第二轮失败", yuan: 0.012, costUnknown: true });
});

it("估价和免费检查使用约定路径，检查请求带上变化秒数", async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith("estimates") ? { analyzeYuan: 0.08 } : { issues: [], yuan: 0 })));
  vi.stubGlobal("fetch", fetcher);
  await expect(api.videoRewriteEstimates()).resolves.toEqual({ analyzeYuan: 0.08 });
  const check = { cardId: "r-1", videoPrompt: "0-6秒：人物。", duration: 6, materials: [], changeSeconds: [2.5] };
  await expect(api.checkVideoPrompt(check)).resolves.toEqual({ issues: [], yuan: 0 });
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/video-rewrite/estimates", "/api/video-rewrite/check"]);
  expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "POST", body: JSON.stringify(check) });
});

it("明确预检拒绝没有模型费用，网络断线仍交给调用方标未知", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "缺少 Key，这次没发出去，没花钱。" }), { status: 400 })));
  await expect(api.analyzeVideo({ cardId: "r", source: { type: "upload", id: "v" }, userText: "换人物" }))
    .rejects.toMatchObject({ yuan: 0, costUnknown: false });
});
