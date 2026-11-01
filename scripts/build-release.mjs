import { build } from 'vite';
import { isMain } from './command.mjs';

// 仍使用项目的 Vite 配置；发版构建显式关闭 env 文件加载，避免读取本机私密配置。
export function buildPage(root = process.cwd(), options = {}) {
  return build({ ...options, root, envFile: false });
}

if (isMain(import.meta.url)) {
  buildPage().catch(() => { console.error('Vite 页面构建失败，请检查上面的构建错误。'); process.exitCode = 1; });
}
