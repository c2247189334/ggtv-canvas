import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tempDir } from './testKit.mjs';
import { listZip } from '../scripts/zip.mjs';

const load = () => import('../scripts/pack-release.mjs');
function put(root, file, value = 'sample') {
  mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), value);
}

test('整合包白名单只复制运行文件，额外文件不跟进，缺少必需文件即拒绝', async () => {
  const { assembleRelease, SERVER_FILES, SCRIPT_FILES, ROOT_FILES } = await load();
  const root = tempDir(), out = join(tempDir(), 'bundle');
  for (const file of [...SERVER_FILES, ...SCRIPT_FILES, ...ROOT_FILES]) put(root, file);
  put(root, 'dist/index.html'); put(root, 'dist/assets/a.js'); put(root, 'dist/THIRD_PARTY_LICENSES.md');
  put(root, '.env.local', 'PRIVATE=should-not-copy'); put(root, 'server/unlisted.mjs');
  put(root, 'server/fixtures/private.mp4'); put(root, 'docs/plans/private.md');
  const files = assembleRelease(root, out);
  assert.ok(files.includes('dist/assets/a.js')); assert.ok(files.includes('server/start.mjs'));
  assert.ok(files.includes('dist/THIRD_PARTY_LICENSES.md'), '页面打包进来的开源库许可声明要随包发');
  assert.equal(existsSync(join(out, '.env.local')), false);
  assert.equal(existsSync(join(out, 'server/unlisted.mjs')), false);
  assert.equal(existsSync(join(out, 'server/fixtures/private.mp4')), false);
  assert.equal(existsSync(join(out, 'package.json')), false, '.mjs 不需要根 package.json');
  assert.equal(readFileSync(join(out, 'dist/index.html'), 'utf8'), 'sample');
  assert.throws(() => assembleRelease(tempDir(), join(tempDir(), 'missing')), /缺少/);
  const noNotice = tempDir();
  for (const file of [...SERVER_FILES, ...SCRIPT_FILES, ...ROOT_FILES]) put(noNotice, file);
  put(noNotice, 'dist/index.html');
  assert.throws(() => assembleRelease(noNotice, join(tempDir(), 'bundle')), /第三方许可/);
});

test('包内禁带检查拒绝每个禁项、大小写变体和嵌套目录', async () => {
  const { assertAllowed, FORBIDDEN } = await load();
  for (const entry of FORBIDDEN) {
    assert.throws(() => assertAllowed([`nested/${entry}/x`]), /禁带/, entry);
    assert.throws(() => assertAllowed([entry.toUpperCase()]), /禁带/, entry);
  }
  for (const file of ['dist/kit/helper.js', 'dist/app.test.js', 'dist/a.spec.ts', 'docs/私人笔记.md', 'DOCS/x/y.md']) {
    assert.throws(() => assertAllowed([file]), /禁带/, file);
  }
  assert.doesNotThrow(() => assertAllowed(['dist/index.html', 'server/start.mjs', 'docs/安装说明.md']));
});

test('dist 混入禁项或符号链接时打包中止，不执行 zip', async () => {
  const { packRelease, SERVER_FILES, SCRIPT_FILES, ROOT_FILES } = await load();
  for (const link of [false, true]) {
    const root = tempDir(), calls = [];
    for (const file of [...SERVER_FILES, ...SCRIPT_FILES, ...ROOT_FILES]) put(root, file);
    put(root, 'package.json', '{"version":"1.2.3"}'); put(root, 'dist/index.html'); put(root, 'dist/THIRD_PARTY_LICENSES.md');
    if (link) symlinkSync(tempDir(), join(root, 'dist/linked'), 'junction');
    else put(root, 'dist/.env.local');
    await assert.rejects(packRelease({ root, exec: async (...args) => { calls.push(args); } }), /禁带|链接/);
    assert.equal(calls.length, 1, '仅允许 build，禁止产出 zip');
    assert.equal(existsSync(join(root, 'release/ggtv-canvas-1.2.3-win.zip')), false);
  }
});

test('打包先 build 再用 Node 自己压 zip（不调系统 tar），压 zip 失败不留下正式产物；成功返回清单和大小', async () => {
  const { packRelease, SERVER_FILES, SCRIPT_FILES, ROOT_FILES } = await load();
  for (const failZip of [true, false]) {
    const root = tempDir(), calls = [];
    for (const file of [...SERVER_FILES, ...SCRIPT_FILES, ...ROOT_FILES]) put(root, file);
    put(root, 'package.json', '{"version":"1.2.3"}'); put(root, 'dist/index.html'); put(root, 'dist/THIRD_PARTY_LICENSES.md');
    const exec = async (cmd, args) => { calls.push([cmd, args]); };
    const action = failZip ? packRelease({ root, exec, zip: () => { throw Error('zip failed'); } }) : packRelease({ root, exec });
    if (failZip) {
      await assert.rejects(action, /zip failed/);
      assert.equal(existsSync(join(root, 'release/ggtv-canvas-1.2.3-win.zip')), false);
    } else {
      const result = await action;
      assert.ok(result.bytes > 0 && existsSync(result.zip)); assert.ok(result.files.includes('server/start.mjs'));
      assert.ok(existsSync(join(result.directory, 'dist/index.html')));
      const names = listZip(result.zip);
      assert.ok(names.includes('ggtv-canvas-1.2.3-win/server/start.mjs') && names.includes('ggtv-canvas-1.2.3-win/dist/index.html'));
      assert.ok(names.every(name => name.startsWith('ggtv-canvas-1.2.3-win/')), '解压出来是一个同名文件夹');
    }
    assert.equal(calls.length, 1, '只有 build 一个外部命令，没有 tar');
    assert.equal(calls[0][0], process.execPath); assert.ok(calls[0][1][0].replaceAll('\\', '/').endsWith('scripts/build-release.mjs'));
  }
});

test('打包页面禁用env文件加载，测试目录里的VITE字段不能进入页面', async () => {
  const { buildPage } = await import('../scripts/build-release.mjs');
  const root = tempDir('release-build-');
  put(root, 'index.html', '<html><body><script type="module" src="/entry.js"></script></body></html>');
  put(root, 'entry.js', 'document.body.textContent = import.meta.env.VITE_FAKE_TEST;');
  put(root, '.env.local', 'VITE_FAKE_TEST=do-not-bundle-this-test-value');
  await buildPage(root, { configFile: false, logLevel: 'silent' });
  const { readdirSync } = await import('node:fs');
  const js = readdirSync(join(root, 'dist/assets')).find(file => file.endsWith('.js'));
  assert.doesNotMatch(readFileSync(join(root, 'dist/assets', js), 'utf8'), /do-not-bundle-this-test-value/);
});
