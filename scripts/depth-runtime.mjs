import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UV_ARCHIVE, VDA_ARCHIVE, VDA_COMMIT } from './depth-download.mjs';
import { assertArchive, assertNoLinks } from './install-safety.mjs';
import { windowsTar } from './command.mjs';

// 新驱动（如 621.01）把表头的「CUDA Version」改名成「CUDA UMD Version」，两种都认。
export function cudaVersion(header) {
  const match = header.match(/CUDA (?:UMD )?Version:\s*(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export async function requireGpu(exec) {
  let result;
  try { result = await exec('nvidia-smi', []); }
  catch { throw Error('深度要 NVIDIA 显卡，这台电脑用不了深度，其他功能不受影响'); }
  const version = cudaVersion(result.stdout);
  if (!version) throw Error('无法识别 nvidia-smi 的 CUDA Version，请检查 NVIDIA 显卡驱动。');
  if (version[0] < 12 || version[0] === 12 && version[1] < 8) throw Error('请先更新 NVIDIA 显卡驱动（需要支持 CUDA 12.8 或更新版本）。');
}

export function isolatedEnv(root, env) {
  const runtime = join(root, 'runtime');
  return { ...env, UV_PYTHON_INSTALL_DIR: join(runtime, 'python'), UV_CACHE_DIR: join(runtime, 'cache/uv'),
    UV_PYTHON_BIN_DIR: join(runtime, 'tools'), UV_TOOL_DIR: join(runtime, 'tools/uv-tools'),
    UV_TOOL_BIN_DIR: join(runtime, 'tools'), UV_NO_CONFIG: '1', UV_PYTHON_PREFERENCE: 'only-managed',
    UV_LINK_MODE: 'copy', PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
    TEMP: join(runtime, 'tmp'), TMP: join(runtime, 'tmp') };
}

export async function ensureUv(root, { exec, downloadFile, log, env = process.env }) {
  try { await exec('uv', ['--version']); log('PATH 已有 uv，跳过下载。'); return 'uv'; }
  catch { log('PATH 没有可用 uv，使用项目内便携版。'); }
  const tools = join(root, 'runtime/tools'), uv = join(tools, 'uv.exe');
  const archive = join(tools, 'uv-0.13.6.zip');
  const tar = windowsTar({ env });
  // 即便已解压也校验 zip，避免中断下载留下的坏文件被当成完成。
  await downloadFile(UV_ARCHIVE, archive);
  if (!existsSync(uv)) await exec(tar, ['-xf', archive, '-C', tools]);
  if (!existsSync(uv)) throw Error('uv 解压失败，缺少 uv.exe。');
  await exec(uv, ['--version']); return uv;
}

export async function ensureVenv(root, uv, { exec, log }) {
  const venv = join(root, 'runtime/depth-venv'), python = join(venv, 'Scripts/python.exe');
  if (!existsSync(python)) {
    // 「只用 uv 管的 Python」由 isolatedEnv 的 UV_PYTHON_PREFERENCE 管；再加 --managed-python 会被 uv 判冲突。
    await exec(uv, ['venv', '--python', '3.11', venv]);
  } else log('Python 环境已存在，跳过创建。');
  if (!existsSync(python)) throw Error('Python 环境创建失败，缺少 python.exe。');
  await exec(python, ['-c', 'import sys; assert sys.version_info[:2] == (3, 11), "Python 3.11 required"']);
  return python;
}

const TORCH = { torch: '2.8.0+cu128', torchvision: '0.23.0+cu128' };
const OTHER = { numpy: '2.2.6', 'opencv-python-headless': '4.12.0.88', easydict: '1.13', einops: '0.8.1', tqdm: '4.67.1' };
export async function ensurePackages(uv, python, cn, { exec, log }) {
  for (const [versions, index] of [[TORCH, 'https://download.pytorch.org/whl/cu128'],
    [OTHER, cn ? 'https://pypi.tuna.tsinghua.edu.cn/simple' : 'https://pypi.org/simple']]) {
    const check = ['-c', `import importlib.metadata as m; expected=${JSON.stringify(versions)}; assert all(m.version(k)==v for k,v in expected.items())`];
    try { await exec(python, check); log('这一组固定版本已装好，跳过安装。'); continue; }
    catch { log('安装这一组固定版本，请稍等（下载过程可能较久）。'); }
    const specs = Object.entries(versions).map(([name, version]) => `${name}==${version.replace('+cu128', '')}`);
    await exec(uv, ['pip', 'install', '--python', python, '--index-url', index, ...specs]);
    await exec(python, check);
  }
}

export async function ensureSource(root, { exec, downloadFile, log, env = process.env }) {
  const model = join(root, 'runtime/Video-Depth-Anything'), marker = '.ggtv-source-commit';
  if (existsSync(join(model, marker)) && readFileSync(join(model, marker), 'utf8') === VDA_COMMIT &&
      existsSync(join(model, 'video_depth_anything/video_depth.py'))) {
    log('固定版本 VDA 源码已装好，跳过。'); return model;
  }
  if (existsSync(model)) throw Error('runtime/Video-Depth-Anything 已存在但不完整，请先移走这个目录后重试（没有覆盖）。');
  const tar = windowsTar({ env });
  const tools = join(root, 'runtime/tools'), archive = join(tools, `vda-${VDA_COMMIT}.zip`);
  await downloadFile(VDA_ARCHIVE, archive);
  const stage = mkdtempSync(join(tools, '.vda-'));
  try {
    const extracted = join(stage, `Video-Depth-Anything-${VDA_COMMIT}`);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const entries = await exec(tar, ['-tf', archive]);
        const verbose = await exec(tar, ['-tvf', archive]);
        assertArchive(entries.stdout, verbose.stdout, `Video-Depth-Anything-${VDA_COMMIT}`);
        await exec(tar, ['-xf', archive, '-C', stage]);
        if (!existsSync(join(extracted, 'video_depth_anything/video_depth.py'))) throw Error('缺少预期源码');
        assertNoLinks(stage);
        break;
      } catch {
        if (attempt === 1) throw Error('VDA 压缩包无法安全解压或缺少预期源码，请检查下载源后重试。');
        log('源码压缩包无法解压或结构不对，重新下载一次。'); rmSync(archive);
        await downloadFile(VDA_ARCHIVE, archive);
      }
    }
    writeFileSync(join(extracted, marker), VDA_COMMIT, 'utf8');
    renameSync(extracted, model); return model;
  } finally {
    if (dirname(stage) !== tools) throw Error('源码临时目录越界，拒绝清理');
    rmSync(stage, { recursive: true, force: true });
  }
}

export function prepareRuntime(root) {
  const runtime = join(root, 'runtime');
  assertNoLinks(runtime, { allowWithin: runtime });
  assertNoLinks(join(root, '.env.local'));
  for (const directory of ['tools', 'tmp']) mkdirSync(join(root, 'runtime', directory), { recursive: true });
}
