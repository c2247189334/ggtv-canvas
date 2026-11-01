import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configured, readEnvFile } from '../server/config.mjs';
import { MODEL_FILES } from '../server/mesh/client.mjs';
import { NODE_SOURCES, CUSTOM_NODE_PACKAGES, MODEL_DOWNLOADS, modelSize } from './mesh-requirements.mjs';
import { isMain } from './command.mjs';

const fileFound = path => existsSync(path) && statSync(path).isFile();
export function checkMesh({ comfyuiDir = '' } = {}) {
  const items = [];
  const add = (name, ok, detail) => items.push({ name, ok, detail });
  if (!comfyuiDir.trim() || comfyuiDir.trim().startsWith('请')) {
    add('COMFYUI_DIR', false, '没填：请在 .env.local 填 ComfyUI 便携版目录，或用 --comfyui-dir <路径>。');
    return { ok: false, version: '', items };
  }
  const root = resolve(comfyuiDir);
  for (const file of ['python_embeded/python.exe', 'ComfyUI/main.py']) {
    add(file, fileFound(join(root, file)), '缺少时请重新解压完整的 Windows ComfyUI 便携版；COMFYUI_DIR 指向最外层目录。');
  }
  const versionFile = join(root, 'ComfyUI/comfyui_version.py');
  const version = fileFound(versionFile) ? readFileSync(versionFile, 'utf8').match(/__version__\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? '' : '';
  for (const [file, types] of Object.entries(NODE_SOURCES)) {
    const path = join(root, 'ComfyUI', file);
    const text = fileFound(path) ? readFileSync(path, 'utf8') : '';
    for (const type of types) {
      const definition = new RegExp(`^\\s*class\\s+${type}\\b|\\bnode_id\\s*=\\s*["']${type}["']`, 'm');
      add(`${type}（${file}）`, definition.test(text), '缺少时更新/换用包含此内置节点的 ComfyUI 便携版，参见 docs/安装说明.md。');
    }
  }
  for (const name of CUSTOM_NODE_PACKAGES) {
    const path = join(root, 'ComfyUI/custom_nodes', name);
    add(`自定义节点包 ${name}`, existsSync(path) && statSync(path).isDirectory(), '请按 docs/安装说明.md 安装到 custom_nodes/。');
  }
  if (!CUSTOM_NODE_PACKAGES.length) add('自定义节点包', true, '本工作流无需另装节点包，已检查 ComfyUI 内置节点源码。');
  for (const [folder, name] of MODEL_FILES) {
    const { url, bytes } = MODEL_DOWNLOADS[name];
    add(`models/${folder}/${name}`, fileFound(join(root, 'ComfyUI/models', folder, name)),
      `请下载同名模型到 ComfyUI/models/${folder}/；下载：${url}（${modelSize(bytes)}，${bytes} 字节）；国内可把域名换成 hf-mirror.com。`);
  }
  return { ok: items.every(item => item.ok), version, items };
}

export function meshCli(argv = [], { root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), log = console.log } = {}) {
  let comfyuiDir;
  if (argv.length) {
    if (argv[0] !== '--comfyui-dir' || argv.length !== 2 || !argv[1]?.trim() || argv[1].startsWith('--')) {
      throw Error('用法：node scripts/check-mesh.mjs [--comfyui-dir <路径>]，请提供完整路径。');
    }
    comfyuiDir = argv[1];
  } else comfyuiDir = configured(readEnvFile(root), 'COMFYUI_DIR');
  const result = checkMesh({ comfyuiDir });
  log(`白模环境体检${result.version ? `（ComfyUI ${result.version}）` : ''}`);
  for (const item of result.items) log(`${item.ok ? '✓' : '✗'} ${item.name}${!item.ok || item.name === '自定义节点包' ? `：${item.detail}` : ''}`);
  log('仅检查文件是否齐全，没有启动 ComfyUI；节点能否加载、显卡和模型能否推理还需实际运行验证。');
  log(result.ok ? '文件体检通过。' : '白模环境未齐，请按 ✗ 后面的说明补齐。');
  return result.ok ? 0 : 1;
}

if (isMain(import.meta.url)) {
  try { process.exitCode = meshCli(process.argv.slice(2)); }
  catch { console.error('白模体检失败：请检查参数路径、文件读取权限和 .env.local 配置。'); process.exitCode = 1; }
}
