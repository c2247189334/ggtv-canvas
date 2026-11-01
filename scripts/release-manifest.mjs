// 显式白名单。fake 模块被入口静态导入，必须保留；测试媒体不随正式包发布。
export const SERVER_FILES = [
  'app', 'cleanup', 'config', 'fakeArk', 'fakeSeedance', 'http', 'imageSize', 'jobInput', 'log',
  'mp4', 'net', 'networkErrors', 'png', 'pricing', 'queue', 'rewrite', 'seedance', 'seedream',
  'soundtrack', 'start', 'streamNet', 'tos', 'videoJobInput', 'videoModels', 'videoQueue',
  'videoReferences', 'wav',
  'depth/executor', 'depth/local', 'depth/queue', 'depth/videoClip',
  'mesh/cleanup', 'mesh/client', 'mesh/errors', 'mesh/local', 'mesh/process', 'mesh/purpose',
  'mesh/segments', 'mesh/workflow',
  'routes/assets', 'routes/canvases', 'routes/jobs', 'routes/localMedia', 'routes/rewrite',
  'routes/videoJobs', 'routes/videoRewrite',
  'store/canvases', 'store/files', 'store/jobs', 'store/spend', 'store/uploads', 'store/works',
  'videoRewrite/analyze', 'videoRewrite/client', 'videoRewrite/fake', 'videoRewrite/input',
  'videoRewrite/lookPeople', 'videoRewrite/modelJson', 'videoRewrite/promptImages',
  'videoRewrite/roles', 'videoRewrite/rules', 'videoRewrite/sheets', 'videoRewrite/storage',
  'videoRewrite/stream', 'videoRewrite/writePrompt',
].map(name => `server/${name}.mjs`).concat('server/depth/depth_video.py');

export const SCRIPT_FILES = [
  'setup-depth', 'depth-download', 'depth-env', 'depth-runtime', 'command', 'check-mesh',
  'mesh-requirements',
  'install-safety',
].map(name => `scripts/${name}.mjs`);

export const ROOT_FILES = [
  '一键启动.bat', '停止.bat', '安装深度.bat', '检查白模环境.bat', '.env.example', 'docs/安装说明.md',
];

export const FORBIDDEN = [
  '.env.local', '数据', '.fake-data', '日志', 'node_modules', 'PROGRESS.md', '进度档案',
  '参考截图', 'docs/plans', 'docs/specs', 'CLAUDE.md', 'AGENTS.md',
  '.claude', '.git', 'release', 'runtime',
  'tests', 'fixtures', 'kit', 'testKit.mjs', 'routeTestKit.mjs', 'responseFixture.mjs',
];

export function assertAllowed(files) {
  for (const file of files) {
    const path = `/${file.replaceAll('\\', '/').toLowerCase()}/`;
    // docs 下只许带安装说明，其余文档（设计、拆解、计划）一律不进包。
    const privateDoc = /^\/docs\/(?!安装说明\.md\/$)[^/]/.test(path);
    if (privateDoc || FORBIDDEN.some(entry => path.includes(`/${entry.toLowerCase()}/`)) || /\.(?:test|spec)\.[^/]+\/$/i.test(path)) {
      throw Error(`包内禁带：${file}`);
    }
  }
}
