// 调本机 Claude Code 命令行（claude -p）：拆解、看人物图、看图定稿都走它，用的是用户自己在 Claude Code 里登录的账号，不走 API Key。
// 11-14 官方条款（legal-and-compliance）：开发者不能收集、存储、转交 Claude 的登录凭证，登录必须走官方流程。所以本程序不读、不存、不转交任何令牌，
// 只看用户有没有用官方方式登录过（.credentials.json 在不在，不读内容），子进程里还会去掉令牌和 API Key 变量，只用用户自己的官方登录。
// 找 claude.exe 的顺序：.env.local 的 CLAUDE_CLI → PATH 里的 claude → 用户文件夹 .local/bin（官方安装器默认位置）→ 桌面版 Claude 自带的那份（路径带版本号，挑最新）。别用 --bare（只认 API Key）。
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runAgentProcess, startable } from './agentProcess.mjs';
import { configured } from './config.mjs';

export const CLAUDE_DEFAULT_MODEL = 'sonnet';
export const CLAUDE_LOGIN_HINT = '在终端运行 claude，按提示用你自己的 Claude 账号登录（本程序不读也不存你的登录信息）';
export const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

function versionKey(name) {
  return name.split('.').map(part => Number(part) || 0);
}
function newest(names) {
  return [...names].sort((a, b) => {
    const [x, y] = [versionKey(a), versionKey(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
    return 0;
  })[0];
}

/** 返回 claude 可执行文件的完整路径，找不到返回 ''。不执行任何程序。 */
export function findClaudeCli(env, { exists = existsSync, readdir = dir => readdirSync(dir), path = process.env.PATH ?? '',
  localAppData = process.env.LOCALAPPDATA ?? '', platform = process.platform, userHome = homedir() } = {}) {
  const filled = configured(env, 'CLAUDE_CLI');
  if (filled) return startable(filled) && exists(filled) ? filled : '';
  const names = platform === 'win32' ? ['claude.exe'] : ['claude'];
  for (const dir of path.split(delimiter).filter(Boolean)) {
    for (const name of names) { const file = join(dir.replace(/^"|"$/g, ''), name); if (exists(file)) return file; }
  }
  // 官方安装器默认装在用户文件夹的 .local/bin。刚装完时本进程的 PATH 还是旧的，直接看这里，设置里点「重新检查」就认得到。
  if (userHome) { const file = join(userHome, '.local', 'bin', names[0]); if (exists(file)) return file; }
  if (!localAppData) return '';
  const data = join(localAppData, 'Claude-Data');
  if (!exists(data)) return '';
  const safe = dir => { try { return readdir(dir); } catch { return []; } };
  for (const app of safe(data)) {
    const codeDir = join(data, app, 'claude-code');
    const version = newest(safe(codeDir));
    if (!version) continue;
    for (const build of safe(join(codeDir, version))) {
      const file = join(codeDir, version, build, 'claude.exe');
      if (exists(file)) return file;
    }
  }
  return '';
}

/** Claude Code 放官方登录的文件夹：用户设了 CLAUDE_CONFIG_DIR 就是它，否则 ~/.claude（官方 authentication 文档）。 */
export function claudeConfigDir(processEnv = process.env, home = homedir()) {
  return processEnv.CLAUDE_CONFIG_DIR || join(home, '.claude');
}

/** 设置面板和页面用：命令行找没找到、用户自己登录过没有、用哪个模型；不报路径，不读登录内容。 */
export function claudeHealth(env, options = {}) {
  const { exists = existsSync, home = claudeConfigDir() } = options;
  const claudeCli = Boolean(findClaudeCli(env, options)), claudeLogin = exists(join(home, '.credentials.json'));
  return { claudeReady: claudeCli && claudeLogin, claudeCli, claudeLogin, claudeModel: configured(env, 'CLAUDE_MODEL') || CLAUDE_DEFAULT_MODEL };
}

/** 子进程的环境：去掉当前会话带的 Claude Code 变量（否则它以为自己在别的会话里），也去掉令牌和 API Key（不花 API 的钱，只用用户自己的官方登录）。 */
export function childEnv(base) {
  const env = {};
  for (const [key, value] of Object.entries(base)) if (!/^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_PID|ANTHROPIC_)/.test(key)) env[key] = value;
  return env;
}

/** 只开 Read（看图）、不问权限、不存会话、不认斜杠命令。提问放最后、前面隔 `--`：用户原话以「-」开头时不会被当成选项。 */
export function cliArgs({ userPrompt, system, model }) {
  return ['-p', '--system-prompt', system, '--output-format', 'json', '--model', model, '--safe-mode',
    '--tools', 'Read', '--allowedTools', 'Read', '--permission-prompts', 'none', '--no-session-persistence', '--disable-slash-commands',
    '--', userPrompt];
}

/** 把 claude 的 JSON 回话变成文字和用量；出错抛人话。 */
export function parseCliOutput(stdout, stderr = '') {
  let body;
  try { body = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? ''); }
  catch { throw Error(`Claude 没有按格式回话。${(stderr || stdout).trim().slice(0, 300)}`); }
  if (body.is_error || typeof body.result !== 'string') {
    const text = String(body.result ?? body.error ?? '未知错误');
    if (/authenticate|OAuth|login|token/i.test(text)) throw Error(`Claude 没登录或登录过期：${text.slice(0, 200)}。${CLAUDE_LOGIN_HINT}。`);
    throw Error(`Claude 调用失败：${text.slice(0, 300)}`);
  }
  const text = body.result.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  if (!text) throw Error('Claude 回了空内容。');
  const usage = body.usage ?? {};
  return { text, model: typeof body.model === 'string' ? body.model : Object.keys(body.modelUsage ?? {})[0] ?? '', elapsedMs: body.duration_ms ?? null,
    usage: { input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
      output_tokens: usage.output_tokens ?? 0 } };
}

/**
 * call({ system, prompt, files: [{ name, buffer }], model, timeoutMs? }) → { text, model, elapsedMs, usage }。timeoutMs 单次覆盖统一超时（看图定稿用）。
 * 文件写进临时目录当工作目录，让 Claude 用 Read 看；做完删掉。登录用用户自己的官方登录，本程序不碰。
 */
export function createClaudeCall({ env, tmpRoot, launch = spawn, timeoutMs = CLAUDE_TIMEOUT_MS, findCli = findClaudeCli, baseEnv = process.env }) {
  return async function call({ system, prompt, files = [], model, timeoutMs: limit = timeoutMs }) {
    const cli = findCli(env);
    if (!cli) throw Error('找不到 claude 命令行。装 Claude 桌面版或 Claude Code，或在 .env.local 填 CLAUDE_CLI（要 claude.exe 的完整路径，npm 装出来的 claude.cmd 用不了）。');
    const args = cliArgs({ userPrompt: prompt, system, model: model || configured(env, 'CLAUDE_MODEL') || CLAUDE_DEFAULT_MODEL });
    const output = await runAgentProcess({ name: 'Claude', command: 'claude', cli, args, files, tmpRoot, env: childEnv(baseEnv), launch, limit });
    return parseCliOutput(output.stdout, output.stderr);
  };
}
