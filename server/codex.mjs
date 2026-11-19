// 调本机 Codex 命令行（codex exec）：和 claude.mjs 同一个 call 接口。登录走 codex login 存下的账号，不用往 .env.local 填令牌。
// 找 codex 的顺序：.env.local 的 CODEX_CLI → PATH 里的 codex → 桌面版带的那份（文件夹名是哈希、会变，挑文件最新的）。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runAgentProcess, startable } from './agentProcess.mjs';
import { configured } from './config.mjs';

export const CODEX_TIMEOUT_MS = 5 * 60 * 1000;
// 11-19：别再叫人去终端敲 codex login——桌面版自带的那份不在 PATH 里，敲了报「不是内部或外部命令」。登录按钮见 agentLogin.mjs。
export const CODEX_LOGIN_HINT = '点右上角「设置」，在「本机 AI 助手」里点「登录 Codex」，在弹出的官方窗口和浏览器里用你自己的账号登录';
const isImage = file => /\.(jpe?g|png|webp)$/i.test(file.name);

/** 返回 codex 可执行文件的完整路径，找不到返回 ''。不执行任何程序。 */
export function findCodexCli(env, { exists = existsSync, readdir = dir => readdirSync(dir), mtime = file => statSync(file).mtimeMs,
  path = process.env.PATH ?? '', localAppData = process.env.LOCALAPPDATA ?? '', platform = process.platform } = {}) {
  const filled = configured(env, 'CODEX_CLI');
  if (filled) return startable(filled) && exists(filled) ? filled : '';
  const name = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const dir of path.split(delimiter).filter(Boolean)) { const file = join(dir.replace(/^"|"$/g, ''), name); if (exists(file)) return file; }
  if (!localAppData) return '';
  const root = join(localAppData, 'OpenAI', 'Codex', 'bin');
  if (!exists(root)) return '';
  return readdir(root).map(folder => join(root, folder, 'codex.exe')).filter(file => exists(file)).sort((a, b) => mtime(b) - mtime(a))[0] ?? '';
}

/** 命令行找没找到、登录过没有、用哪个模型。登录只看 auth.json 在不在，绝不读它。 */
export function codexHealth(env, options = {}) {
  const { exists = existsSync, home = process.env.CODEX_HOME || join(homedir(), '.codex') } = options;
  const cli = Boolean(findCodexCli(env, options)), login = exists(join(home, 'auth.json'));
  return { ready: cli && login, cli, login, model: configured(env, 'CODEX_MODEL') || '默认' };
}

/** 只读沙箱、不存会话；不读个人配置和项目 AGENTS.md（临时目录在项目里，会读到开发规矩）。 */
export function codexArgs({ images, model }) {
  return ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '-c', 'project_doc_max_bytes=0', '--color', 'never',
    ...(model ? ['-m', model] : []), ...images.flatMap(file => ['-i', file]), '--json', '-'];
}

/** codex exec 没有单独的系统提示参数，放最前。文字材料直接贴进来，不让它自己开文件。 */
export function codexPrompt({ system, prompt, files = [] }) {
  const images = files.filter(isImage).map(file => file.name), texts = files.filter(file => !isImage(file));
  const parts = [system];
  if (files.length) parts.push(`${images.length ? `图片已经作为附件发给你，顺序和文件名一一对应：${images.join('、')}。` : ''}文字材料贴在下面。下面说的 Read 就是看这些内容，不用再去开文件。`);
  for (const file of texts) parts.push(`【${file.name}】\n${file.buffer.toString('utf8')}`);
  return [...parts, prompt].join('\n\n');
}

/** 一行一个事件。只有 turn.failed 才算失败：item 里的 error 是配置警告，顶层 error 是重连提示。 */
export function parseCodexEvents(stdout, stderr = '') {
  let text = '', usage = null, failure = null;
  for (const line of stdout.split('\n')) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event?.type === 'item.completed' && event.item?.type === 'agent_message') text = String(event.item.text ?? '');
    else if (event?.type === 'turn.completed') usage = event.usage ?? {};
    else if (event?.type === 'turn.failed') failure = String(event.error?.message ?? '未知错误');
  }
  if (failure !== null) {
    if (/\b401\b|Unauthorized|login/i.test(failure)) throw Error(`Codex 登录没通过：${failure.slice(0, 200)}。${CODEX_LOGIN_HINT}。`);
    throw Error(`Codex 调用失败：${failure.slice(0, 300)}`);
  }
  if (usage === null) throw Error(`Codex 没有按格式回话。${(stderr || stdout).trim().slice(0, 300)}`);
  const clean = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if (!clean) throw Error('Codex 回了空内容。');
  return { text: clean, usage: { input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0 } };
}

/** 和 createClaudeCall 同样的 call。传进来的 model 是给 Claude 的（sonnet / opus），这里不认，只用 CODEX_MODEL。 */
export function createCodexCall({ env, tmpRoot, launch = spawn, timeoutMs = CODEX_TIMEOUT_MS, findCli = findCodexCli, baseEnv = process.env }) {
  return async function call({ system, prompt, files = [], timeoutMs: limit = timeoutMs }) {
    const cli = findCli(env);
    if (!cli) throw Error('找不到 codex 命令行。装 Codex（桌面版或命令行），或在 .env.local 填 CODEX_CLI（要 codex.exe 的完整路径，npm 装出来的 codex.cmd 用不了）。');
    const model = configured(env, 'CODEX_MODEL'), images = files.filter(isImage), started = Date.now();
    const output = await runAgentProcess({ name: 'Codex', command: 'codex', cli, args: codexArgs({ images: images.map(file => file.name), model }),
      input: codexPrompt({ system, prompt, files }), files: images, tmpRoot, env: baseEnv, launch, limit });
    return { ...parseCodexEvents(output.stdout, output.stderr), model: model || 'codex', elapsedMs: Date.now() - started };
  };
}
