import { expect, it } from "vitest";
import { cardCounter, cardTitle, newCard, newVideoCard } from "./cards";
import { localMediaProblem, localChild, settleDepth, busyLocalJobs, stopConfirmText } from "./localMedia";
import { emptyHistory, recordHistory, undoHistory, redoHistory } from "./history";
import type { CardNode, DepthJobView, Health } from "@/types";
import { fromDoc, toDoc } from "./canvasDoc";

const source: CardNode = { id: "v", type: "card", position: { x: 10, y: 20 }, data: newVideoCard("upload", 7, [{ type: "upload", id: "u", media: "video", hasAudio: true }]) };
const health: Health = { ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0,
  ffmpegFound: true, ffprobeFound: true, depth: { python: { filled: true, found: true }, modelDir: { filled: true, found: true }, extraPackages: { filled: true, found: true } } };

it('深度缺少或未知ffprobe先拦截，声音和白模不要求ffprobe，假模式不挡', () => {
  for (const ffprobeFound of [false, undefined]) {
    expect(localMediaProblem({ ...health, ffprobeFound }, 'depth')).toContain('ffprobe');
    expect(localMediaProblem({ ...health, ffprobeFound }, 'audio')).toBeNull();
    expect(localMediaProblem({ ...health, ffprobeFound, mesh: { ready: true, url: { filled: false, found: true }, directory: { filled: false, found: false } } }, 'mesh')).toBeNull();
    expect(localMediaProblem({ ...health, ffprobeFound, fake: true }, 'depth')).toBeNull();
  }
});

it("新卡在右边隔100顶对齐，来源线一次撤销重做", () => {
  const created = localChild(source, "audio", 1, "a", "2026-10-22T00:00:00Z");
  expect(created.node.position).toEqual({ x: 390, y: 20 });
  expect(created.node.data).toMatchObject({ kind: "audio", source: "extracted", note: "提取中…" });
  expect(created.edge).toMatchObject({ source: "v", target: "a" });
  const before = { nodes: [source], edges: [] };
  const after = { nodes: [source, created.node], edges: [created.edge] };
  const history = recordHistory(emptyHistory(), before, after);
  const undo = undoHistory(history, after);
  expect(undo.graph).toEqual(before);
  expect(redoHistory(undo.history, undo.graph).graph).toEqual(after);
});

it("真模式预检说清缺项、填写位置和ffmpeg，假模式不挡；未知health安全报错", () => {
  expect(localMediaProblem({ ...health, depth: { ...health.depth!, extraPackages: { filled: false, found: false } } }, "depth")).toBeNull();
  expect(localMediaProblem(health, "depth")).toBeNull();
  expect(localMediaProblem({ ...health, depth: { ...health.depth!, python: { filled: false, found: false } } }, "depth")).toContain("DEPTH_PYTHON");
  expect(localMediaProblem({ ...health, depth: undefined }, "depth")).toContain(".env.local");
  expect(localMediaProblem({ ...health, ffmpegFound: false }, "audio")).toContain("ffmpeg");
  expect(localMediaProblem({ ...health, fake: true, ffmpegFound: false, depth: undefined }, "depth")).toBeNull();
});

it("图片、视频、深度和声音共用编号，打开旧画布后新卡仍从1数", () => {
  const take = cardCounter();
  expect(newCard("generate", take()).number).toBe(1);
  expect(newVideoCard("work", take()).number).toBe(2);
  expect(localChild(source, "depth", take(), "d", "now").node.data.number).toBe(3);
  expect(localChild(source, "audio", take(), "a", "now").node.data.number).toBe(4);
  const loaded = fromDoc(toDoc({ id: "c", name: "c" }, [source], []));
  expect(loaded.nodes[0].data.number).toBe(7);
  expect(cardCounter()()).toBe(1);
});

it("深度单成功收视频元数据、失败保留原话并清单号，不自动重跑", () => {
  const { node } = localChild(source, "depth", 8, "d", "2026-10-22T00:00:00Z");
  node.data.depthJobId = "job";
  const view: DepthJobView = { id: "job", kind: "depth", source: { type: "upload", id: "u" }, resolution: "720p", phase: null,
    status: "succeeded", count: 1, works: ["w"], error: null, errorCode: null, createdAt: "now",
    workMeta: [{ id: "w", duration: 2, width: 1280, height: 720, hasAudio: false, fps: 30 }] };
  const done = settleDepth(node.data, view);
  expect(done.depthJobId).toBeUndefined();
  expect(done.results).toEqual([{ type: "work", id: "w", media: "video", depth: true, seconds: 2, width: 1280, height: 720, hasAudio: false, fps: 30 }]);
  expect(settleDepth(node.data, { ...view, status: "failed", works: [], error: "深度原话" })).toMatchObject({ note: "深度原话", results: [] });
});

it('白模复用本机建卡与收单逻辑，保留白模种类、标题、来源线和原话', () => {
  const { node, edge } = localChild(source, 'mesh', 9, 'mesh', 'now');
  expect(cardTitle(node.data)).toBe('视频 9 · 白模');
  expect(node.data).toMatchObject({ source: 'mesh', mediaSource: source.data.results[0] });
  expect(edge).toMatchObject({ source: 'v', target: 'mesh' });
  node.data.depthJobId = 'job';
  const view: DepthJobView = { id: 'job', kind: 'mesh', source: { type: 'upload', id: 'u' }, resolution: '480p', phase: null,
    status: 'succeeded', count: 1, works: ['w'], error: null, errorCode: null, createdAt: 'now' };
  expect(settleDepth(node.data, view).results).toEqual([{ type: 'work', id: 'w', media: 'video', mesh: true }]);
  expect(settleDepth(node.data, { ...view, status: 'failed', works: [], error: '白模失败原话' })).toMatchObject({ note: '白模失败原话', results: [] });
});

it('白模体检独立于深度；默认本机地址可用、目录可选，填写错误说出缺项', () => {
  const mesh = { ready: true, url: { filled: false, found: true }, directory: { filled: false, found: false } };
  expect(localMediaProblem({ ...health, mesh, depth: undefined }, 'mesh')).toBeNull();
  expect(localMediaProblem({ ...health, mesh: { ...mesh, url: { filled: true, found: false } } }, 'mesh')).toContain('COMFYUI_URL');
  expect(localMediaProblem({ ...health, mesh: { ...mesh, ready: false, directory: { filled: true, found: false } } }, 'mesh')).toContain('COMFYUI_DIR');
  expect(localMediaProblem({ ...health, fake: true, mesh: undefined }, 'mesh')).toBeNull();
});

it('白模没开也没便携版时先拦，提示打开ComfyUI或填目录；已打开时不受坏目录影响', () => {
  const mesh = { ready: false, url: { filled: false, found: true }, directory: { filled: false, found: false } };
  const message = localMediaProblem({ ...health, mesh }, 'mesh');
  expect(message).toContain('打开 ComfyUI'); expect(message).toContain('COMFYUI_DIR'); expect(message).toContain('.env.local');
  expect(localMediaProblem({ ...health, mesh: { ...mesh, ready: true, directory: { filled: true, found: false } } }, 'mesh')).toBeNull();
});

// 10-31 用户：连点深度、白模，新卡叠在同一个位置，看不出第二张在生成；要往下排、不许重叠。
it("连点深度和白模：第二张往下排，按来源竖屏比例预留出片后的高度", () => {
  const portrait: CardNode = { id: "p", type: "card", position: { x: 10, y: 20 },
    data: newVideoCard("upload", 1, [{ type: "upload", id: "u", media: "video", width: 540, height: 960 }]) };
  const first = localChild(portrait, "depth", 2, "d", "now", [portrait]).node;
  expect(first.position).toEqual({ x: 390, y: 20 });
  const second = localChild(portrait, "mesh", 3, "m", "now", [portrait, first]).node;
  expect(second.position).toEqual({ x: 390, y: 20 + Math.ceil(280 * 960 / 540) + 40 + 40 });
  const third = localChild(portrait, "audio", 4, "a", "now", [portrait, first, second]).node;
  expect(third.position.y).toBeGreaterThanOrEqual(second.position.y + Math.ceil(280 * 960 / 540) + 80);
});

// 10-31 用户：删卡停不掉后台；生成中的深度 / 白模卡删除前要确认，确认后一起停。
it("删卡：挑出还在生成的深度 / 白模单号，确认文案说清会一起停", () => {
  const busy = { ...newVideoCard("mesh", 2), depthJobId: "job-1" };
  const done = newVideoCard("depth", 3);
  const nodes: CardNode[] = [{ id: "a", type: "card", position: { x: 0, y: 0 }, data: busy },
    { id: "b", type: "card", position: { x: 0, y: 0 }, data: done }, source];
  expect(busyLocalJobs(nodes)).toEqual(["job-1"]);
  expect(busyLocalJobs([source])).toEqual([]);
  expect(stopConfirmText(1)).toBe("这张卡还在生成，删掉会同时停止后台，确定吗？");
  expect(stopConfirmText(2)).toBe("有 2 张卡还在生成，删掉会同时停止后台，确定吗？");
});
