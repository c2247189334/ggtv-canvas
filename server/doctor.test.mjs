import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectFacts, doctorReport, nodeOk } from '../scripts/doctor.mjs';
import { tempDir } from './testKit.mjs';

// 11-17 用户定：加一条体检命令，新手和帮新手装的 AI 助手一次看清能不能启动、还缺什么、怎么补。
const ready = { nodeVersion: 'v22.22.2', nodeOk: true, hasDeps: true, hasDist: false, portFree: true, keyReady: true, tosReady: true,
  ffmpegFound: true, ffprobeFound: true, agentName: 'Claude', agentReady: true, agentModel: 'sonnet', agentProblem: null, depthReady: true, meshReady: true };

test('Node 门槛和启动脚本一样：20.19 以上的 20.x、22.12 以上、更高的大版本', () => {
  for (const version of ['20.19.0', '22.12.0', '22.22.2', '24.1.0']) assert.equal(nodeOk(version), true, version);
  for (const version of ['18.20.0', '20.18.9', '21.7.0', '22.11.0']) assert.equal(nodeOk(version), false, version);
});

test('全备齐：每项 OK，结论是可以启动、各项功能都备齐', () => {
  const { lines, canStart, todo } = doctorReport(ready);
  const text = lines.join('\n');
  assert.equal(canStart, true); assert.equal(todo, 0);
  assert.equal(text.includes('[缺]'), false);
  assert.match(text, /\[OK\] Node\.js：v22\.22\.2/);
  assert.match(text, /\[OK\] Claude：已就绪，模型 sonnet/);
  assert.match(text, /结论：可以启动。双击 一键启动\.bat，浏览器会打开 http:\/\/127\.0\.0\.1:5290.*各项功能都备齐了。/);
});

test('刚克隆下来的新电脑：能启动，但逐项说清缺什么和怎么办；Key 要用户本人在设置里填', () => {
  const { lines, canStart, todo } = doctorReport({ ...ready, keyReady: false, tosReady: false, ffmpegFound: false, ffprobeFound: false,
    agentReady: false, agentProblem: '本机 Claude 没配好：装 Claude Code。', depthReady: false, meshReady: false });
  const text = lines.join('\n');
  assert.equal(canStart, true); assert.equal(todo, 3);
  assert.match(text, /\[缺\] 火山 Key：还没填/);
  assert.match(text, /AI 助手不要向用户要 Key，也不要替用户填/);
  assert.match(text, /\[可晚点\] TOS 三项/);
  assert.match(text, /\[缺\] ffmpeg \/ ffprobe：没找到 ffmpeg、ffprobe\n {8}怎么办：在终端运行 winget install Gyan\.FFmpeg/);
  assert.match(text, /\[缺\] Claude：本机 Claude 没配好：装 Claude Code。/);
  assert.match(text, /\[选装\] 深度动作捕捉：没装/); assert.match(text, /\[选装\] 白模动作捕捉：没装/);
  assert.match(text, /还有 3 项功能没备齐/);
});

test('Node 太旧或没有页面：结论是还不能启动；端口被占只提醒不算缺', () => {
  const old = doctorReport({ nodeVersion: 'v18.20.0', nodeOk: false, hasDeps: true, hasDist: false, portFree: true });
  assert.equal(old.canStart, false);
  assert.match(old.lines.join('\n'), /\[缺\] Node\.js：v18\.20\.0 版本太旧\n {8}怎么办：装 Node\.js 22\.12 或以上/);
  const bare = doctorReport({ ...ready, hasDeps: false, hasDist: false });
  assert.equal(bare.canStart, false);
  assert.match(bare.lines.join('\n'), /\[缺\] 页面：没有装依赖，也没有打包好的页面\n {8}怎么办：在项目文件夹运行 npm ci/);
  assert.match(bare.lines.join('\n'), /结论：还不能启动/);
  assert.match(doctorReport({ ...ready, hasDeps: false, hasDist: true }).lines.join('\n'), /\[OK\] 页面：已打包好（整合包）/);
  const running = doctorReport({ ...ready, portFree: false, ggtvRunning: true });
  assert.equal(running.canStart, true); assert.equal(running.todo, 0);
  assert.match(running.lines.join('\n'), /\[OK\] 端口 5290：GG TV 已经开着，直接打开 http:\/\/127\.0\.0\.1:5290 就行/);
  // 11-17 真让 AI 助手试装发现：开着的可能是用户装在别处、正在用的另一份，不能教人去双击 停止.bat（它按端口找进程，会把那份关掉）。
  const portLine = running.lines.find(line => line.includes('端口 5290'));
  assert.equal(portLine.includes('停止.bat'), false);
  assert.match(portLine, /一次只能开一份.*先关掉正开着那份的黑窗口/);
  const busy = doctorReport({ ...ready, portFree: false, ggtvRunning: false });
  assert.equal(busy.canStart, true); assert.equal(busy.todo, 0);
  assert.match(busy.lines.join('\n'), /\[注意\] 端口 5290：被别的程序占着（不是 GG TV）\n {8}怎么办：先关掉占着它的那个程序再启动。.*不要自己去结束进程/);
});

test('真查一个临时文件夹：认得出整合包页面和填没填，清单里不带任何配置值', async () => {
  const root = tempDir();
  mkdirSync(join(root, 'dist'));
  writeFileSync(join(root, 'dist', 'index.html'), '<!doctype html>');
  writeFileSync(join(root, '.env.local'), 'ARK_API_KEY=ark-secret-value\nTOS_BUCKET=请填北京区TOS桶名\n');
  const facts = await collectFacts(root, { port: 0, probe: async () => { throw Error('端口空着就不该问'); } });
  assert.equal(facts.portFree, true); assert.equal(facts.ggtvRunning, false);
  assert.equal(facts.hasDist, true); assert.equal(facts.hasDeps, false);
  assert.equal(facts.keyReady, true); assert.equal(facts.tosReady, false);
  const text = JSON.stringify(facts) + doctorReport(facts).lines.join('\n');
  assert.equal(text.includes('ark-secret-value'), false);
  assert.equal(text.includes(root), false);
});
