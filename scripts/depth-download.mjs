import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { execute } from './command.mjs';

export const VDA_COMMIT = '4f5ae23172ba60fd7bc11ef671cca678842c7072';
export const UV_ARCHIVE = {
  urls: ['https://github.com/astral-sh/uv/releases/download/0.13.6/uv-x86_64-pc-windows-msvc.zip'],
  bytes: 15239500, sha256: 'a2a8820d5eea32f08ef467ef3b7f66883a9b076d5737a2fc2fbb5f458d1bb50f',
};
export const VDA_ARCHIVE = {
  urls: [`https://github.com/DepthAnything/Video-Depth-Anything/archive/${VDA_COMMIT}.zip`],
};
export const WEIGHT = {
  urls: ['https://huggingface.co/depth-anything/Video-Depth-Anything-Small/resolve/main/video_depth_anything_vits.pth',
    'https://hf-mirror.com/depth-anything/Video-Depth-Anything-Small/resolve/main/video_depth_anything_vits.pth'],
  bytes: 116440756, sha256: '13379300b739e659f076a59d52e9801bd8d38c541a7e71f73bbca4dcfb013609',
};

export async function verified(file, resource) {
  if (!existsSync(file) || !statSync(file).isFile()) return false;
  const size = statSync(file).size;
  if (!size || resource.bytes !== undefined && size !== resource.bytes) return false;
  if (!resource.sha256) return true;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex') === resource.sha256;
}

export async function download(resource, file, { exec = execute, env = process.env, log = () => {} } = {}) {
  if (await verified(file, resource)) { log('下载文件已完成校验，跳过。'); return; }
  mkdirSync(dirname(file), { recursive: true });
  const part = `${file}.part`;
  if (existsSync(file)) { log('已有下载校验不对，重新下载。'); rmSync(file); }
  const curlEnv = { ...env, ...(env.HTTPS_PROXY ? { https_proxy: env.HTTPS_PROXY } : {}),
    ...(env.HTTP_PROXY ? { http_proxy: env.HTTP_PROXY } : {}) };
  let integrityFailure = false;
  for (const [index, url] of resource.urls.entries()) {
    if (index) log('主下载地址失败，改用 hf-mirror 镜像再试。');
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await exec('curl.exe', ['--fail', '--location', '--retry', '3', '--retry-delay', '2',
          '--connect-timeout', '20', '--speed-limit', '1024', '--speed-time', '60', '-C', '-', '-o', part, url], { env: curlEnv });
      } catch (error) {
        if ([33, 36].includes(error.code) && attempt === 0) {
          log('下载源不支持续传，改为重新下载。'); rmSync(part, { force: true }); continue;
        }
        break;
      }
      if (await verified(part, resource)) { renameSync(part, file); return; }
      integrityFailure = true;
      log('下载大小或 SHA256 校验失败，丢弃坏文件后重下。');
      rmSync(part, { force: true });
    }
  }
  if (integrityFailure) throw Error('下载校验失败，请检查代理或下载源后重试，没有使用损坏文件。');
  throw Error(resource.urls[0].includes('github.com')
    ? '连不上 GitHub，请开代理或设置 HTTPS_PROXY 后重新双击'
    : '连不上 Hugging Face 和镜像，请开代理或设置 HTTPS_PROXY 后重新双击');
}
