/** 页面和本机小服务说话的唯一出口。小服务回错误时，把它给的那句人话原样抛出来，页面直接显示。 */
import type { AudioWorkView, CanvasDoc, CanvasSave, CanvasSummary, DepthJobRequest, DepthJobView, FrameRequest, Health, JobRequest, JobView, LocalJobView, LocalMediaRequest, RewriteResult, VideoJobRequest, WorkView } from "@/types";
import type { RewriteRefs } from "@/domain/rewrite";
import type { AnalyzeVideoRequest, AnalyzeVideoResult, CheckVideoRequest, WriteVideoRequest, WriteVideoResult } from "./videoRewriteApiTypes";
import type { VideoClipRequest, VideoClipUpload } from './types';

const OFFLINE = "连不上本机小服务。看看黑窗口还开着没有，或者重新双击 一键启动.bat。";

type Init = { json?: unknown; body?: Blob; keepalive?: boolean };

async function call<T>(method: string, path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;
  if (init.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.json);
  } else if (init.body) {
    headers["Content-Type"] = init.body.type;
    body = init.body;
  }
  let response: Response;
  try {
    response = await fetch(path, { method, headers, body, keepalive: init.keepalive });
  } catch {
    throw new Error(OFFLINE);
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* 不是 JSON */
  }
  if (!response.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    const charge = data as { yuan?: number; costUnknown?: boolean } | null;
    throw Object.assign(new Error(typeof message === "string" ? message : `小服务出错了（${response.status}）。`), {
      status: response.status,
      ...(path.startsWith("/api/video-rewrite/") && response.status < 500 ? { yuan: 0, costUnknown: false } : {}),
      ...(typeof charge?.yuan === "number" ? { yuan: charge.yuan } : {}),
      ...(typeof charge?.costUnknown === "boolean" ? { costUnknown: charge.costUnknown } : {})
    });
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  videoRewriteEstimates: () => call<{ analyzeYuan: number; lookYuan: number }>("GET", "/api/video-rewrite/estimates"),
  analyzeVideo: (json: AnalyzeVideoRequest) => call<AnalyzeVideoResult>("POST", "/api/video-rewrite/analyze", { json }),
  writeVideoPrompt: (json: WriteVideoRequest) => call<WriteVideoResult>("POST", "/api/video-rewrite/prompt", { json }),
  checkVideoPrompt: (json: CheckVideoRequest) => call<{ issues: string[]; yuan: number }>("POST", "/api/video-rewrite/check", { json }),
  health: () => call<Health>("GET", "/api/health"),
  listCanvases: () => call<CanvasSummary[]>("GET", "/api/canvases"),
  createCanvas: (name: string) => call<CanvasDoc>("POST", "/api/canvases", { json: { name } }),
  getCanvas: (id: string) => call<CanvasDoc>("GET", `/api/canvas?id=${q(id)}`),
  saveCanvas: (doc: CanvasSave, keepalive = false) =>
    call<{ ok: true; updatedAt: string; version: number }>("PUT", `/api/canvas?id=${q(doc.id)}`, { json: doc, keepalive }),
  deleteCanvas: (id: string) => call<{ ok: true }>("DELETE", `/api/canvas?id=${q(id)}`),
  upload: (file: Blob) => call<{ id: string; kind: "image" | "video"; duration?: number; width?: number; height?: number; hasAudio?: boolean; fps?: number | null }>("POST", "/api/uploads", { body: file }),
  listWorks: () => call<WorkView[]>("GET", "/api/works"),
  deleteWork: (id: string) => call<{ ok: true }>("DELETE", `/api/works?id=${q(id)}`),
  probeImage: async (url: string, signal?: AbortSignal): Promise<number | null> => {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store", signal });
      return response.status;
    } catch {
      return null;
    }
  },
  submitJob: (request: JobRequest) => call<{ id: string }>("POST", "/api/jobs", { json: request }),
  submitVideoJob: (request: VideoJobRequest) => call<{ id: string }>("POST", "/api/video-jobs", { json: request }),
  submitDepthJob: (request: DepthJobRequest) => call<{ id: string }>("POST", "/api/depth-jobs", { json: request }),
  submitMeshJob: (request: LocalMediaRequest) => call<{ id: string }>('POST', '/api/mesh-jobs', { json: request }),
  stopLocalJob: (id: string) => call<{ status: 'stopped' | 'stopping' }>('POST', '/api/local-jobs/stop', { json: { id } }),
  extractAudio: (request: LocalMediaRequest) => call<AudioWorkView>("POST", "/api/audio-extractions", { json: request }),
  extractFrame: (request: FrameRequest) => call<{ id: string; kind: "image" }>("POST", "/api/frame-extractions", { json: request }),
  clipVideo: (request: VideoClipRequest) => call<VideoClipUpload>('POST', '/api/video-clips', { json: request }),
  rewritePrompt: (prompt: string, kind: "image" | "video", refs?: RewriteRefs) => call<RewriteResult>("POST", "/api/rewrite", { json: { prompt, kind, refs } }),
  listMediaWorks: () => call<Array<WorkView | AudioWorkView>>("GET", "/api/works"),
  getDepthJobs: (ids: string[]) => call<DepthJobView[]>("GET", `/api/jobs?ids=${ids.map(q).join(",")}`),
  findLocalJobs: (canvasId: string, cardIds: string[]) => call<LocalJobView[]>('GET', `/api/local-jobs?canvasId=${q(canvasId)}&cardIds=${cardIds.map(q).join(',')}`),
  getJobs: (ids: string[]) => call<JobView[]>("GET", `/api/jobs?ids=${ids.map(q).join(",")}`)
};

export function workDownloadUrl(id: string): string {
  return `/api/works/file?id=${q(id)}&download=1`;
}
