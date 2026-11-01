import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync,
  readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execute, isMain, windowsTar } from './command.mjs';
import { assertNoLinks } from './install-safety.mjs';
import { SERVER_FILES, SCRIPT_FILES, ROOT_FILES, assertAllowed } from './release-manifest.mjs';
export { SERVER_FILES, SCRIPT_FILES, ROOT_FILES, FORBIDDEN, assertAllowed } from './release-manifest.mjs';

function walk(root, prefix = '') {
  return readdirSync(join(root, prefix)).flatMap(name => {
    const file = prefix ? `${prefix}/${name}` : name, stat = lstatSync(join(root, file));
    if (stat.isSymbolicLink()) throw Error(`不允许链接：${file}`);
    return stat.isDirectory() ? [file, ...walk(root, file)] : [file];
  });
}

export function assembleRelease(root, destination) {
  if (!existsSync(join(root, 'dist/index.html'))) throw Error('缺少 dist/index.html');
  // 页面里打包了 React、React Flow 等开源库，它们的许可要求随包附上声明（vite.config.ts 的 build.license 生成）。
  if (!existsSync(join(root, 'dist/THIRD_PARTY_LICENSES.md'))) throw Error('缺少第三方许可清单 dist/THIRD_PARTY_LICENSES.md');
  if (lstatSync(join(root, 'dist')).isSymbolicLink()) throw Error('不允许链接：dist');
  const dist = walk(join(root, 'dist')).filter(file => lstatSync(join(root, 'dist', file)).isFile());
  const files = [...SERVER_FILES, ...SCRIPT_FILES, ...ROOT_FILES, ...dist.map(file => `dist/${file}`)];
  if (existsSync(join(root, 'LICENSE'))) files.push('LICENSE');
  // 目录本身也检查，空的禁带目录不能绕过。
  assertAllowed([...files, ...walk(join(root, 'dist')).map(file => `dist/${file}`)]);
  for (const file of files) {
    const source = join(root, file);
    if (!existsSync(source)) throw Error(`缺少必需文件：${file}`);
    let current = source;
    while (current !== resolve(root)) {
      if (lstatSync(current).isSymbolicLink()) throw Error(`不允许链接：${file}`);
      current = dirname(current);
    }
    mkdirSync(dirname(join(destination, file)), { recursive: true });
    copyFileSync(source, join(destination, file));
  }
  assertAllowed(walk(destination));
  return files.sort();
}

export async function packRelease({ root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), exec = execute, env = process.env } = {}) {
  root = resolve(root);
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!/^[\dA-Za-z][\dA-Za-z.+-]*$/.test(version ?? '')) throw Error('package.json version 不合法');
  const name = `ggtv-canvas-${version}-win`, release = join(root, 'release');
  const directory = join(release, name), zip = join(release, `${name}.zip`);
  assertNoLinks(release);
  if (existsSync(directory) || existsSync(zip)) throw Error('同版本整合包已存在，请先移走旧包再打包。');
  const tar = windowsTar({ env });
  await exec(process.execPath, [join(root, 'scripts/build-release.mjs')], { cwd: root, env, inherit: true });
  mkdirSync(release, { recursive: true });
  const stage = mkdtempSync(join(release, '.pack-')), stagedZip = join(stage, `${name}.zip`);
  try {
    const files = assembleRelease(root, join(stage, name));
    console.log(`禁带检查通过：${files.length} 个文件，0 个禁带项。`);
    await exec(tar, ['-a', '-c', '-f', stagedZip, '-C', stage, name], { cwd: root, env, inherit: true });
    const bytes = statSync(stagedZip).size;
    renameSync(join(stage, name), directory); renameSync(stagedZip, zip);
    return { directory, zip, bytes, files };
  } finally {
    // stage 是本次 mkdtemp 返回的绝对目录，且固定在项目 release 下。
    if (dirname(stage) !== release) throw Error('临时打包目录越界，拒绝清理');
    rmSync(stage, { recursive: true, force: true });
  }
}

if (isMain(import.meta.url)) {
  packRelease().then(result => {
    console.log(result.files.slice(0, 60).join('\n'));
    console.log(`总数：${result.files.length}；zip：${result.zip}；${result.bytes} 字节`);
  }).catch(error => { console.error(`打包失败：${error.message}`); process.exitCode = 1; });
}
