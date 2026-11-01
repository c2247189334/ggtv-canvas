import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, isMain } from './command.mjs';
import { download, WEIGHT } from './depth-download.mjs';
import { updateDepthEnv } from './depth-env.mjs';
import { requireGpu, isolatedEnv, ensureUv, ensureVenv, ensurePackages, ensureSource, prepareRuntime } from './depth-runtime.mjs';

export async function setupDepth({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  argv = [], exec = execute, downloadFile = download, env = process.env, log = console.log } = {}) {
  const unknown = argv.filter(arg => !['--cn', '--dry-run'].includes(arg));
  if (unknown.length) throw Error('参数只支持 --cn 和 --dry-run。');
  root = resolve(root);
  const cn = argv.includes('--cn'), dry = argv.includes('--dry-run');
  const steps = [
    '查显卡：nvidia-smi 表头 CUDA Version 至少 12.8',
    '准备 uv：优先 PATH，否则下载并校验便携版到 runtime/tools',
    '创建 Python 3.11：环境、Python 下载、缓存和临时文件全在 runtime/',
    `安装固定版本：torch 2.8.0 / torchvision 0.23.0 用官方 cu128；其他包用${cn ? '清华 https://pypi.tuna.tsinghua.edu.cn/simple' : 'PyPI'}`,
    `准备固定 commit 的 VDA 源码和 Small 权重：${cn ? '优先 hf-mirror' : 'HF 失败自动换 hf-mirror'}，权重核大小和 SHA256`,
    '补 .env.local 的 DEPTH_PYTHON 和 DEPTH_MODEL_DIR；保留已有配置和其他内容',
    '自检：torch.cuda.is_available() 和 VideoDepthAnything 导入',
  ];
  const step = index => log(`[${index + 1}/7] ${steps[index]}${dry ? '（仅预览）' : '…'}`);
  if (dry) { steps.forEach((_, index) => step(index)); log('预览结束，没有执行命令、下载、建目录或改文件。'); return; }
  step(0); await requireGpu(exec);
  prepareRuntime(root);
  const runtimeEnv = isolatedEnv(root, env);
  const run = (command, args, options = {}) => exec(command, args, { ...options, env: { ...runtimeEnv, ...options.env } });
  const getFile = (resource, file) => downloadFile(resource, file, { exec: run, env: runtimeEnv, log });
  const context = { exec: run, downloadFile: getFile, log, env: runtimeEnv };
  step(1); const uv = await ensureUv(root, context);
  step(2); const python = await ensureVenv(root, uv, context);
  step(3);
  try { await ensurePackages(uv, python, cn, context); }
  catch (error) { throw Error(`Python 包安装或版本核验失败，请检查代理、网络和硬盘空间后重试（可加 --cn）。\n${error.message}`); }
  step(4); const model = await ensureSource(root, context);
  await getFile({ ...WEIGHT, urls: cn ? [...WEIGHT.urls].reverse() : WEIGHT.urls }, join(model, 'checkpoints/video_depth_anything_vits.pth'));
  step(5); updateDepthEnv(root, { DEPTH_PYTHON: python, DEPTH_MODEL_DIR: model }, log);
  step(6);
  const cuda = await run(python, ['-c', 'import torch; print(torch.cuda.is_available())'], { cwd: model });
  if (cuda.stdout.trim() !== 'True') throw Error('CUDA 不可用，请更新 NVIDIA 驱动后重试；其他功能不受影响。');
  try { await run(python, ['-c', 'from video_depth_anything.video_depth import VideoDepthAnything'], { cwd: model }); }
  catch (error) { throw Error(`VDA 导入失败，请重新运行安装脚本检查 Python 包和源码是否齐全。\n${error.message}`); }
  log('自检通过：CUDA 可用，VideoDepthAnything 可以导入。');
  // 装好的环境和 uv 下载缓存各占约 7GB（11-01 实测），自检过了缓存就没用了。
  await run(uv, ['cache', 'clean']);
  log('已清掉下载缓存（约 7GB）。');
  log('完成。重新双击 一键启动.bat，深度就能用了');
}

if (isMain(import.meta.url)) {
  setupDepth({ argv: process.argv.slice(2) }).catch(error => {
    console.error(`深度安装失败：${error.message}`); process.exitCode = 1;
  });
}
