// 小服务的配置：端口、数据放哪、是不是「假火山」模式、Key 填没填。
// Key 只在这里读；任何接口都只报告「填没填」，绝不返回值本身。
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PORT = 5290;
export const videoRewriteRoot = dataRoot => join(dataRoot, '改写');

/** 读项目根目录的 .env.local。没有、读坏了都返回空对象，不抛。每次调用都重新读，改了 Key 不用重启。 */
export function readEnvFile(root = projectRoot) {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return {};
  try {
    return parseEnv(readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
}

/** `--name=value` 形式的命令行参数。没有返回 undefined。 */
export function argValue(argv, name) {
  const prefix = `--${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit === undefined ? undefined : hit.slice(prefix.length);
}

/**
 * 这次启动用什么配置。
 * 假火山模式（--fake）不许碰真的 数据/：没指定 --data 时一律落到 .fake-data/。
 */
export function runtimeOptions(argv = process.argv.slice(2), env = process.env, root = projectRoot) {
  const fake = argv.includes('--fake') || env.CANVAS_FAKE_ARK === '1';
  const data = argValue(argv, 'data') ?? env.CANVAS_DATA_ROOT ?? (fake ? '.fake-data' : '数据');
  const port = Number(argValue(argv, 'port') ?? env.PORT ?? DEFAULT_PORT);
  return {
    port: Number.isInteger(port) && port >= 0 && port < 65536 ? port : DEFAULT_PORT,
    dataRoot: resolve(root, data),
    fake,
    distDir: join(root, 'dist'),
    logDir: join(root, '日志')
  };
}

/** 火山 Key 填没填。空的、还是模板里「请…」开头的提示语，都算没填。 */
export function keyFilled(env) {
  const value = String(env?.ARK_API_KEY ?? '').trim();
  return Boolean(value) && !/^请/.test(value);
}

/** 只报 TOS 三项是否齐全，绝不返回配置值。 */
export function tosFilled(env) {
  return ['TOS_ACCESS_KEY_ID', 'TOS_SECRET_ACCESS_KEY', 'TOS_BUCKET'].every((name) => {
    const value = String(env?.[name] ?? '').trim();
    return Boolean(value) && !/^请/.test(value);
  });
}

export function configured(env, name) {
  const value = String(env?.[name] ?? '').trim();
  return value && !/^请/.test(value) ? value : '';
}

/** 只做文件存在性体检，不执行程序，不返回本机路径。 */
export function depthHealth(env, { exists = existsSync, path = process.env.PATH ?? '' } = {}) {
  const python = configured(env, 'DEPTH_PYTHON');
  const model = configured(env, 'DEPTH_MODEL_DIR');
  const packages = configured(env, 'DEPTH_EXTRA_PACKAGES');
  const toolFound = name => path.split(delimiter).filter(Boolean).some(dir =>
    exists(join(dir.replace(/^"|"$/g, ''), process.platform === 'win32' ? `${name}.exe` : name)));
  return { depth: {
    python: { filled: Boolean(python), found: Boolean(python && exists(python)) },
    modelDir: { filled: Boolean(model), found: Boolean(model && exists(join(model, 'video_depth_anything')) &&
      exists(join(model, 'checkpoints', 'video_depth_anything_vits.pth'))) },
    extraPackages: { filled: Boolean(packages), found: Boolean(packages && exists(packages)) }
  }, ffmpegFound: toolFound('ffmpeg'), ffprobeFound: toolFound('ffprobe') };
}

/** 仅探测本机ComfyUI，连同读响应限700毫秒，为health留出返回时间，不跟随重定向。 */
async function comfyReachable(address, fetch) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(new URL('/system_stats', address).href, { signal: controller.signal, redirect: 'error' });
        if (!response.ok) return false;
        const stats = await response.json();
        return Boolean(stats?.system && Array.isArray(stats.devices));
      })(),
      new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, 700); })
    ]);
  } catch { return false; }
  finally { clearTimeout(timer); controller.abort(); }
}

/** 便携版有效或当前能连接才就绪；只回传状态，不回传配置值。 */
export async function meshHealth(env, { exists = existsSync, fake = false, fetch = globalThis.fetch } = {}) {
  const address = configured(env, 'COMFYUI_URL'), directory = configured(env, 'COMFYUI_DIR');
  let local = false;
  try {
    const url = new URL(address || 'http://127.0.0.1:8188');
    local = ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
  } catch { local = false; }
  const directoryFound = Boolean(directory && exists(join(directory, 'python_embeded', 'python.exe')) && exists(join(directory, 'ComfyUI', 'main.py')));
  const ready = fake || (local && (directoryFound || await comfyReachable(address || 'http://127.0.0.1:8188', fetch)));
  return { mesh: {
    ready,
    url: { filled: Boolean(address), found: fake || local },
    directory: { filled: Boolean(directory), found: fake || directoryFound }
  } };
}
