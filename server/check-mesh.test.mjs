import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tempDir } from './testKit.mjs';
import { meshWorkflow } from './mesh/workflow.mjs';
import { MODEL_FILES } from './mesh/client.mjs';

function put(root, file, text = '') { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); }
async function goodPortable() {
  const { NODE_SOURCES } = await import('../scripts/mesh-requirements.mjs');
  const root = tempDir();
  put(root, 'python_embeded/python.exe'); put(root, 'ComfyUI/main.py');
  put(root, 'ComfyUI/comfyui_version.py', '__version__ = "0.43.0"');
  for (const [source, types] of Object.entries(NODE_SOURCES)) put(root, `ComfyUI/${source}`, types.map(name => `class ${name}: pass\nnode_id="${name}"`).join('\n'));
  for (const [folder, name] of MODEL_FILES) put(root, `ComfyUI/models/${folder}/${name}`);
  return root;
}

test('白模未填、模板值、不存在目录都报缺项；命令参数优先且不读真实env', async () => {
  const { checkMesh, meshCli } = await import('../scripts/check-mesh.mjs');
  for (const comfyuiDir of ['', '请填目录']) {
    const result = checkMesh({ comfyuiDir }); assert.equal(result.ok, false);
    assert.match(result.items[0].detail, /没填/);
  }
  const root = tempDir(), logs = [];
  const result = await meshCli(['--comfyui-dir', join(root, 'absent')], { root, log: line => logs.push(line) });
  assert.equal(result, 1); assert.match(logs.join('\n'), /✗.*python_embeded/);
  assert.deepEqual(readdirSync(root), []);
  assert.throws(() => meshCli(['--comfyui-dir'], { root }), /路径/);
});

test('白模节点常量覆盖工作流全部类型，均来自已核对的内置源码，无需自定义节点包', async () => {
  const { NODE_SOURCES, CUSTOM_NODE_PACKAGES } = await import('../scripts/mesh-requirements.mjs');
  const required = [...new Set(Object.values(meshWorkflow('video', 'test')).map(node => node.class_type))].sort();
  assert.deepEqual(Object.values(NODE_SOURCES).flat().sort(), required);
  assert.deepEqual(CUSTOM_NODE_PACKAGES, []);
});

test('白模结构、各个节点定义、四个模型缺任一项都会失败，并给补齐方法', async () => {
  const { checkMesh } = await import('../scripts/check-mesh.mjs');
  const root = await goodPortable();
  const good = checkMesh({ comfyuiDir: root });
  assert.equal(good.ok, true); assert.equal(good.version, '0.43.0');
  for (const file of ['python_embeded/python.exe', 'ComfyUI/main.py', ...MODEL_FILES.map(([folder, name]) => `ComfyUI/models/${folder}/${name}`)]) {
    const content = 'data'; unlinkSync(join(root, file));
    const result = checkMesh({ comfyuiDir: root });
    assert.equal(result.ok, false, file);
    assert.ok(result.items.some(item => !item.ok && item.detail.length > 5));
    put(root, file, content);
  }
  put(root, 'ComfyUI/comfy_extras/nodes_sam3.py', '# old version missing SAM3_VideoTrack');
  const old = checkMesh({ comfyuiDir: root });
  assert.equal(old.ok, false); assert.ok(old.items.some(item => !item.ok && item.name.includes('SAM3_VideoTrack')));
});

test('白模读测试env配置支持BOM、CRLF，不输出其他密钥；全部齐全返回0', async () => {
  const { meshCli } = await import('../scripts/check-mesh.mjs');
  const comfy = await goodPortable(), root = tempDir(), logs = [];
  put(root, '.env.local', `\uFEFFARK_API_KEY=private-key\r\nCOMFYUI_DIR=${comfy}\r\n`);
  assert.equal(await meshCli([], { root, log: line => logs.push(line) }), 0);
  assert.match(logs.join('\n'), /✓/); assert.match(logs.join('\n'), /0.43.0/);
  assert.doesNotMatch(logs.join('\n'), /private-key|ARK_API_KEY/);
  assert.match(logs.join('\n'), /仅检查文件/);
});

test('四模型下载信息覆盖MODEL_FILES，说明中的链接和GB大小与唯一配置一致', async () => {
  const { MODEL_DOWNLOADS, modelSize } = await import('../scripts/mesh-requirements.mjs');
  assert.deepEqual(Object.keys(MODEL_DOWNLOADS).sort(), MODEL_FILES.map(([, name]) => name).sort());
  const doc = readFileSync(new URL('../docs/安装说明.md', import.meta.url), 'utf8');
  for (const [folder, name] of MODEL_FILES) {
    const { url, bytes } = MODEL_DOWNLOADS[name], parsed = new URL(url);
    assert.equal(parsed.origin, 'https://huggingface.co'); assert.ok(parsed.pathname.startsWith('/Comfy-Org/'));
    assert.ok(parsed.pathname.endsWith(`/${folder}/${name}`)); assert.ok(Number.isSafeInteger(bytes) && bytes > 0);
    const row = doc.split('\n').find(line => line.startsWith(`| \`${name}\``));
    assert.ok(row.includes(url), name); assert.ok(row.includes(modelSize(bytes)), name);
  }
  assert.equal(modelSize(Object.values(MODEL_DOWNLOADS).reduce((sum, model) => sum + model.bytes, 0)), '5.5 GB');
  assert.match(doc, /合计约 5\.5 GB/); assert.match(doc, /4 个链接 2026-11-01 联网核过，大小与作者能跑通的环境一致/);
  assert.doesNotMatch(doc, /待补|未在本次联网核验/);
});

test('每个模型缺失时CLI打印精确链接、大小及镜像提示，恢复文件后不再打印下载信息', async () => {
  const { meshCli } = await import('../scripts/check-mesh.mjs');
  const { MODEL_DOWNLOADS, modelSize } = await import('../scripts/mesh-requirements.mjs');
  const root = await goodPortable();
  for (const [folder, name] of MODEL_FILES) {
    const file = `ComfyUI/models/${folder}/${name}`, logs = [];
    unlinkSync(join(root, file));
    assert.equal(meshCli(['--comfyui-dir', root], { log: line => logs.push(line) }), 1);
    const line = logs.find(item => item.startsWith(`✗ models/${folder}/${name}`));
    const model = MODEL_DOWNLOADS[name];
    assert.ok(line.includes(model.url)); assert.ok(line.includes(modelSize(model.bytes)));
    assert.ok(line.includes(String(model.bytes))); assert.match(line, /国内.*hf-mirror\.com/);
    assert.doesNotMatch(logs.join('\n'), /待补/);
    put(root, file);
  }
  const logs = [];
  assert.equal(meshCli(['--comfyui-dir', root], { log: line => logs.push(line) }), 0);
  assert.doesNotMatch(logs.join('\n'), /https:\/\/huggingface\.co/);
});
