import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempDir } from './testKit.mjs';
const systemTar = join(process.env.SystemRoot || 'C:\\Windows', 'System32/tar.exe');

function put(file, text = '') { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
function harness(root, { uvOnPath = false } = {}) {
  const calls = [], downloads = [], installed = new Set();
  const exec = async (command, args, options = {}) => {
    calls.push({ command, args, options });
    if (command === 'nvidia-smi') return { stdout: '| NVIDIA-SMI 999  Driver Version: 999 CUDA Version: 12.8 |' };
    if (command === 'uv' && !uvOnPath) throw Object.assign(Error('missing'), { code: 'ENOENT' });
    if (args[0] === 'venv') put(join(root, 'runtime/depth-venv/Scripts/python.exe'));
    if (args[0] === 'pip') installed.add(args.includes('torch==2.8.0') ? 'torch' : 'other');
    if (command === systemTar) {
      const { VDA_COMMIT } = await import('../scripts/depth-download.mjs');
      if (args[0] === '-tf') return { stdout: `Video-Depth-Anything-${VDA_COMMIT}/video_depth_anything/video_depth.py\n` };
      if (args[0] === '-tvf') return { stdout: '-rw-r--r-- 0 root root 10 Jan 1 00:00 video_depth.py\n' };
      const out = args[args.indexOf('-C') + 1];
      if (args.some(arg => arg.includes('uv-0.13.6.zip'))) put(join(out, 'uv.exe'));
      else {
        put(join(out, `Video-Depth-Anything-${VDA_COMMIT}/video_depth_anything/video_depth.py`), 'class VideoDepthAnything: pass');
      }
    }
    if (args[0] === '-c') {
      const code = args[1];
      if (code.includes('importlib.metadata') && !installed.has(code.includes('2.8.0+cu128') ? 'torch' : 'other')) throw Error('not installed');
      if (code.includes('cuda.is_available')) return { stdout: 'True\n' };
      return { stdout: '3.11.9\n' };
    }
    return { stdout: 'uv 0.13.6' };
  };
  const downloadFile = async (resource, file) => { downloads.push({ resource, file }); put(file, 'download'); };
  return { exec, downloadFile, calls, downloads };
}

test('显卡版本只读nvidia-smi表头，按数字比较12.8；缺失和过旧都解释原因', async () => {
  const { cudaVersion, requireGpu } = await import('../scripts/depth-runtime.mjs');
  for (const [value, ok] of [['12.7', false], ['12.8', true], ['12.10', true], ['13.0', true], ['11.9', false]]) {
    const header = `| CUDA Version: ${value} |`;
    assert.deepEqual(cudaVersion(header), value.split('.').map(Number));
    if (ok) await requireGpu(async () => ({ stdout: header }));
    else await assert.rejects(requireGpu(async () => ({ stdout: header })), /请先更新 NVIDIA 显卡驱动/);
  }
  assert.equal(cudaVersion('GPU CUDA 99.0'), null);
  // 11-01 用户本机驱动 621.01 的真实表头：旧的「CUDA Version」改名成「CUDA UMD Version」。
  const umd = '| NVIDIA-SMI 621.01                 KMD Version: 621.01        CUDA UMD Version: 13.5     |';
  assert.deepEqual(cudaVersion(umd), [13, 5]);
  await requireGpu(async () => ({ stdout: umd }));
  assert.deepEqual(cudaVersion('| CUDA UMD Version: 12.7 |'), [12, 7]);
  await assert.rejects(requireGpu(async () => { throw Error('not found'); }), /深度要 NVIDIA 显卡，这台电脑用不了深度，其他功能不受影响/);
  await assert.rejects(requireGpu(async () => ({ stdout: 'CUDA Version: N/A' })), /无法识别/);
});

test('dry-run完全无副作用，不执行命令、不下载、不读写配置、不建目录', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  const root = tempDir(), logs = [];
  await setupDepth({ root, argv: ['--dry-run', '--cn'], log: line => logs.push(line),
    exec: async () => assert.fail('dry-run 执行了命令'), downloadFile: async () => assert.fail('dry-run 下载了文件') });
  assert.deepEqual(readdirSync(root), []); assert.equal(logs.filter(line => /^\[\d\/7\]/.test(line)).length, 7);
  assert.match(logs.join('\n'), /清华|tuna/); assert.match(logs.join('\n'), /hf-mirror/);
});

test('完整假执行安装：隔离runtime、固定包版本、首次安装后再次运行跳过已完成步骤', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  const root = tempDir(), h = harness(root), logs = [];
  put(join(root, '.env.example'), 'ARK_API_KEY=keep-this\r\nDEPTH_PYTHON=请填\r\nDEPTH_MODEL_DIR=请填\r\n');
  await setupDepth({ root, ...h, log: line => logs.push(line) });
  assert.equal(h.calls.filter(call => call.args[0] === 'venv').length, 1);
  // 11-01 真装：环境变量已设 UV_PYTHON_PREFERENCE，再带 --managed-python 时 uv 0.13.6 报冲突、退出码 2。
  const venv = h.calls.find(call => call.args[0] === 'venv');
  assert.equal(venv.options.env.UV_PYTHON_PREFERENCE, 'only-managed');
  assert.ok(!venv.args.includes('--managed-python'));
  // 11-01 真装：uv 缓存和装好的环境各 7.2GB，自检通过后清缓存。
  const importCheck = h.calls.findIndex(call => call.args[1]?.includes?.('from video_depth_anything'));
  const cacheClean = h.calls.findIndex(call => call.args[0] === 'cache' && call.args[1] === 'clean');
  assert.ok(importCheck >= 0 && cacheClean > importCheck);
  assert.match(logs.join('\n'), /已清掉下载缓存/);
  assert.equal(h.calls.filter(call => call.args[0] === 'pip').length, 2);
  for (const call of h.calls.filter(call => call.command !== 'nvidia-smi')) {
    assert.equal(call.options.env.UV_PYTHON_INSTALL_DIR, join(root, 'runtime/python'));
    assert.equal(call.options.env.UV_CACHE_DIR, join(root, 'runtime/cache/uv'));
    assert.equal(call.options.env.TEMP, join(root, 'runtime/tmp'));
  }
  const pip = h.calls.filter(call => call.args[0] === 'pip');
  assert.ok(pip[0].args.includes('https://download.pytorch.org/whl/cu128'));
  for (const spec of ['torch==2.8.0', 'torchvision==0.23.0']) assert.ok(pip[0].args.includes(spec));
  for (const spec of ['numpy==2.2.6', 'opencv-python-headless==4.12.0.88', 'easydict==1.13', 'einops==0.8.1', 'tqdm==4.67.1']) assert.ok(pip[1].args.includes(spec));
  const config = readFileSync(join(root, '.env.local'), 'utf8');
  assert.ok(config.includes(`DEPTH_PYTHON=${join(root, 'runtime/depth-venv/Scripts/python.exe')}`));
  assert.ok(config.includes(`DEPTH_MODEL_DIR=${join(root, 'runtime/Video-Depth-Anything')}`));
  assert.doesNotMatch(logs.join('\n'), /keep-this/);
  const start = h.calls.length;
  await setupDepth({ root, ...h, log: line => logs.push(line) });
  assert.equal(h.calls.slice(start).filter(call => ['venv', 'pip'].includes(call.args[0]) || call.command === systemTar).length, 0);
  assert.match(logs.join('\n'), /完成。重新双击 一键启动.bat，深度就能用了/);
});

test('--cn只改PyPI和权重优先地址，PATH uv可复用；CUDA不可用不报完成', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  const root = tempDir(), h = harness(root, { uvOnPath: true }), logs = [];
  put(join(root, '.env.example'), '');
  const exec = async (command, args, options) => args[1]?.includes('cuda.is_available')
    ? { stdout: 'False\n' } : h.exec(command, args, options);
  await assert.rejects(setupDepth({ root, ...h, exec, argv: ['--cn'], log: line => logs.push(line) }), /CUDA 不可用/);
  assert.equal(h.downloads.some(item => item.file.includes('uv-0.13.6.zip')), false);
  assert.ok(h.downloads.find(item => item.file.endsWith('.pth')).resource.urls[0].includes('hf-mirror.com'));
  assert.ok(h.calls.find(call => call.args.includes('numpy==2.2.6')).args.includes('https://pypi.tuna.tsinghua.edu.cn/simple'));
  assert.doesNotMatch(logs.join('\n'), /^完成。/m);
});

test('显卡不支持时不创建runtime或配置；导入VDA失败不报完成', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  const missing = tempDir();
  await assert.rejects(setupDepth({ root: missing, exec: async () => { throw Error('missing'); }, log: () => {} }), /NVIDIA/);
  assert.equal(existsSync(join(missing, 'runtime')), false);
  const root = tempDir(), h = harness(root), logs = [];
  put(join(root, '.env.example'), '');
  await assert.rejects(setupDepth({ root, ...h, log: line => logs.push(line), exec: async (cmd, args, options) => {
    if (args[1]?.includes('from video_depth_anything')) throw Error('外部程序退出码：1；原文：\nModuleNotFoundError: einops');
    return h.exec(cmd, args, options);
  }}), /VDA 导入失败[\s\S]*ModuleNotFoundError: einops/);
  assert.doesNotMatch(logs.join('\n'), /^完成。/m);
  assert.ok(!h.calls.some(call => call.args[0] === 'cache'), '自检没过不清缓存，重跑时不用重下');
  const pipRoot = tempDir(), p = harness(pipRoot);
  put(join(pipRoot, '.env.example'), '');
  await assert.rejects(setupDepth({ root: pipRoot, ...p, log: () => {}, exec: async (cmd, args, options) => {
    if (args[0] === 'pip') throw Error('外部程序退出码：2；原文：\nerror: No space left on device');
    return p.exec(cmd, args, options);
  }}), /Python 包安装或版本核验失败[\s\S]*No space left on device/);
});

test('安装命令包装器保留curl的代理映射，同时继续使用runtime缓存目录', async () => {
  const { setupDepth } = await import('../scripts/setup-depth.mjs');
  const root = tempDir(), h = harness(root, { uvOnPath: true });
  put(join(root, '.env.example'), '');
  await setupDepth({ root, ...h, env: { HTTPS_PROXY: 'http://https-proxy.invalid:1', HTTP_PROXY: 'http://http-proxy.invalid:2' }, log: () => {},
    downloadFile: async (resource, file, options) => {
      await options.exec('curl.exe', [], { env: { ...options.env, https_proxy: options.env.HTTPS_PROXY, http_proxy: options.env.HTTP_PROXY } });
      await h.downloadFile(resource, file);
    } });
  const calls = h.calls.filter(call => call.command === 'curl.exe');
  assert.ok(calls.length > 0);
  for (const call of calls) {
    assert.equal(call.options.env.https_proxy, 'http://https-proxy.invalid:1');
    assert.equal(call.options.env.http_proxy, 'http://http-proxy.invalid:2');
    assert.equal(call.options.env.UV_CACHE_DIR, join(root, 'runtime/cache/uv'));
  }
});
