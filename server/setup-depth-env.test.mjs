import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from './testKit.mjs';

test('深度配置：缺文件用模板、替换空值和占位符；不打印密钥', async () => {
  const { updateDepthEnv } = await import('../scripts/depth-env.mjs');
  const root = tempDir(), logs = [];
  writeFileSync(join(root, '.env.example'), 'ARK_API_KEY=placeholder\r\nDEPTH_PYTHON=请填路径\r\nDEPTH_MODEL_DIR=\r\n');
  updateDepthEnv(root, { DEPTH_PYTHON: 'C:/项目/runtime/python.exe', DEPTH_MODEL_DIR: 'C:/项目/runtime/VDA' }, line => logs.push(line));
  const text = readFileSync(join(root, '.env.local'), 'utf8');
  assert.match(text, /ARK_API_KEY=placeholder\r\n/); assert.doesNotMatch(text, /(?<!\r)\n/);
  assert.match(text, /DEPTH_PYTHON=C:\/项目\/runtime\/python.exe/);
  assert.match(text, /DEPTH_MODEL_DIR=C:\/项目\/runtime\/VDA/);
  assert.doesNotMatch(logs.join('\n'), /ARK_API_KEY|placeholder/);
});

test('深度配置：同值不动，不同值不覆盖；BOM移除、CRLF和其他字段逐字保留', async () => {
  const { updateDepthEnv } = await import('../scripts/depth-env.mjs');
  for (const bom of ['', '\uFEFF']) for (const newline of ['\n', '\r\n']) {
    const root = tempDir(), logs = [], content = `# user${newline}ARK_API_KEY=private-value${newline}DEPTH_PYTHON=other.exe${newline}DEPTH_MODEL_DIR=new-dir${newline}`;
    writeFileSync(join(root, '.env.local'), bom + content);
    updateDepthEnv(root, { DEPTH_PYTHON: 'new.exe', DEPTH_MODEL_DIR: 'new-dir' }, line => logs.push(line));
    assert.equal(readFileSync(join(root, '.env.local'), 'utf8'), content);
    assert.match(logs.join('\n'), /已有配置，没改.*new.exe/);
    assert.doesNotMatch(logs.join('\n'), /private-value|other.exe|ARK_API_KEY/);
  }
});

test('深度配置：不存在模板即报错，不创建半成品；尾部无换行仍正确补行', async () => {
  const { updateDepthEnv } = await import('../scripts/depth-env.mjs');
  const root = tempDir();
  assert.throws(() => updateDepthEnv(root, { DEPTH_PYTHON: 'new.exe' }), /模板/);
  assert.equal(existsSync(join(root, '.env.local')), false);
  writeFileSync(join(root, '.env.local'), 'OTHER=value');
  updateDepthEnv(root, { DEPTH_PYTHON: 'new.exe', DEPTH_MODEL_DIR: 'new-dir' });
  assert.equal(readFileSync(join(root, '.env.local'), 'utf8'), 'OTHER=value\nDEPTH_PYTHON=new.exe\nDEPTH_MODEL_DIR=new-dir\n');
});
