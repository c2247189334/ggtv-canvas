/** 页面和本机小服务说话的唯一出口。小服务回错误时，把它给的那句人话原样抛出来，页面直接显示。 */
import type { AudioWorkView, CanvasDoc, CanvasSave, CanvasSummary, DepthJobRequest, DepthJobView, FrameRequest, Health, JobRequest, JobView, LayerJobRequest, LayerJobView, LayerRedrawRequest, LayerRedrawView, LocalJobView, LocalMediaRequest, OrphanJob, RewriteResult, VideoJobRequest, WorkView } from "@/types";
import type { RewriteRefs } from "@/domain/rewrite";
import type { AnalyzeVideoRequest, AnalyzeVideoResult, CheckVideoRequest, WriteVideoRequest, WriteVideoResult } from "./videoRewriteApiTypes";
import type { VideoClipRequest, VideoClipUpload } from './types';
import type { CharacterGenerateInput, CharacterPatch, CharacterSaveInput, CharacterView } from './characterTypes';
import type { ProductAnalyzeResult, ProductPromptRequest, ProductCheckRequest } from './productRemakeTypes';
import type { UploadList } from './uploadTypes';

/** 保存火山 Key 后小服务顺手验的结果：火山认 / 火山回 401 / 这次没法验（没连上）。没验就没有这一项。 */
export type KeyCheck = 'accepted' | 'rejected' | 'unknown';
export type KeyName = 'ARK_API_KEY' | 'TOS_ACCESS_KEY_ID' | 'TOS_SECRET_ACCESS_KEY' | 'TOS_BUCKET';

const OFFLINE ="连不上本机小服务。看看黑窗口还开着没有，或者重新双击 一键启动.bat。";

type Init = { json?: unknown; body?: Blob; keepalive?: boolean; headers?: Record<string, string> };

async function call<T>(method: string, path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
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
    throw Object.assign(new Error(typeof message === "string" ? message : `小服务出错了（${response.status}）。`), {
      status: response.status
    });
  }
  return data as T;
}

const q = encodeURIComponent;

export const api = {
  analyzeProduct: (json: AnalyzeVideoRequest) => call<ProductAnalyzeResult>('POST', '/api/product-remake/analyze', { json }),
  writeProductPrompt: (json: ProductPromptRequest) => call<WriteVideoResult>('POST', '/api/product-remake/prompt', { json }),
  checkProductPrompt: (json: ProductCheckRequest) => call<{ issues: string[]; yuan: number }>('POST', '/api/product-remake/check', { json }),
  listCharacters: () => call<CharacterView[]>('GET', '/api/characters'),
  saveCharacter: (json: CharacterSaveInput) => call<CharacterView>('POST', '/api/characters', { json }),
  generateCharacter: (json: CharacterGenerateInput) => call<CharacterView>('POST', '/api/characters/generate', { json }),
  patchCharacter: (json: CharacterPatch) => call<CharacterView>('PATCH', '/api/characters', { json }),
  deleteCharacter: (id: string) => call<{ ok: true }>('DELETE', `/api/characters?id=${q(id)}`),
  analyzeVideo: (json: AnalyzeVideoRequest) => call<AnalyzeVideoResult>("POST", "/api/video-rewrite/analyze", { json }),
  writeVideoPrompt: (json: WriteVideoRequest) => call<WriteVideoResult>("POST", "/api/video-rewrite/prompt", { json }),
  checkVideoPrompt: (json: CheckVideoRequest) => call<{ issues: string[]; yuan: number }>("POST", "/api/video-rewrite/check", { json }),
  health: () => call<Health>("GET", "/api/health"),
  /** 设置面板填 Key：写进 .env.local，只回填没填，不回值。 */
  /** 设置里选本机 AI 助手用谁（auto / claude / codex），回最新的助手状态。 */
  saveAgent: (engine: string) => call<Pick<Health, "agent" | "agentName" | "agentReady" | "agentModel" | "agentProblem" | "agentChoice" | "agents">>("POST", "/api/settings/agent", { json: { engine } }),
  /** 设置里选写词强度（standard / strong / max），回最新的助手状态。 */
  /** 设置里点「登录 Claude / Codex」：小服务打开官方登录窗口；already 是那个窗口还开着。 */
  openAgentLogin: (engine: string) => call<{ opened: boolean; already?: boolean }>("POST", "/api/settings/agent-login", { json: { engine } }),
  saveStrength: (strength: string) => call<Pick<Health, "agent" | "agentModel" | "agentStrength">>("POST", "/api/settings/strength", { json: { strength } }),
  saveKeys: (json: Partial<Record<KeyName, string>>) => call<{ saved: KeyName[]; keyReady: boolean; tosReady: boolean; keyCheck?: KeyCheck }>("POST", "/api/settings/keys", { json }),
  listCanvases: () => call<CanvasSummary[]>("GET", "/api/canvases"),
  createCanvas: (name: string) => call<CanvasDoc>("POST", "/api/canvases", { json: { name } }),
  getCanvas: (id: string) => call<CanvasDoc>("GET", `/api/canvas?id=${q(id)}`),
  saveCanvas: (doc: CanvasSave, keepalive = false) =>
    call<{ ok: true; updatedAt: string; version: number }>("PUT", `/api/canvas?id=${q(doc.id)}`, { json: doc, keepalive }),
  deleteCanvas: (id: string) => call<{ ok: true }>("DELETE", `/api/canvas?id=${q(id)}`),
  /** 从电脑传的才给 name：小服务据此记进「我上传的」，同内容只存一份。 */
  upload: (file: Blob, name?: string) => call<{ id: string; kind: "image" | "video"; duration?: number; width?: number; height?: number; hasAudio?: boolean; fps?: number | null }>("POST", "/api/uploads",
    { body: file, ...(name === undefined ? {} : { headers: { "X-Upload-Name": encodeURIComponent(name) } }) }),
  listUploads: () => call<UploadList>("GET", "/api/uploads/list"),
  deleteUpload: (id: string) => call<{ ok: true }>("DELETE", `/api/uploads?id=${q(id)}`),
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
  submitLayerJob: (request: LayerJobRequest) => call<{ id: string }>('POST', '/api/layer-jobs', { json: request }),
  getLayerJobs: (ids: string[]) => call<Array<LayerJobView | LayerRedrawView>>('GET', `/api/jobs?ids=${ids.map(q).join(',')}`),
  submitLayerRedraw: (request: LayerRedrawRequest) => call<{ id: string }>('POST', '/api/layer-redraws', { json: request }),
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
  findOrphanJobs: (canvasId: string, cardIds: string[]) => call<OrphanJob[]>('GET', `/api/orphan-jobs?canvasId=${q(canvasId)}&cardIds=${cardIds.map(q).join(',')}`),
  getJobs: (ids: string[]) => call<JobView[]>("GET", `/api/jobs?ids=${ids.map(q).join(",")}`)
};

export function workDownloadUrl(id: string): string {
  return `/api/works/file?id=${q(id)}&download=1`;
}
