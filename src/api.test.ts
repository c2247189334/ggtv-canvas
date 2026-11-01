import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api", () => {
  it.each([200, 404, 503])("探测图片用不缓存的 GET，原样返回状态码 %s", async (status) => {
    const fetchMock = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    expect(await api.probeImage("/api/works/file?id=w1", controller.signal)).toBe(status);
    expect(fetchMock).toHaveBeenCalledWith("/api/works/file?id=w1", {
      method: "GET", cache: "no-store", signal: controller.signal
    });
  });

  it("探测图片连不上时返回 null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await api.probeImage("/api/uploads/file?id=u1")).toBeNull();
  });

  it("小服务回了错误，就抛它给的那句话", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "这张画布找不到了。" }), { status: 404 })));
    await expect(api.getCanvas("x")).rejects.toThrow("这张画布找不到了。");
  });

  it("连不上小服务，说人话", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await expect(api.health()).rejects.toThrow("连不上本机小服务");
  });

  it("交单发 JSON，带上 Content-Type", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "j1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await api.submitJob({ canvasId: "c", cardId: "k", model: "doubao-seedream-5-0-flash-260915", prompt: "p", size: "1024x1024", count: 1, refs: [] });
    expect(r.id).toBe("j1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/jobs");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});
