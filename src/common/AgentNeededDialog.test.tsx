import { afterEach, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentNeededView } from './AgentNeededDialog';
import { agentNeededProblem, agentReadyOrAsk, askIfAgentMissing, closeAgentNeeded } from './agentNeeded';
import type { Health } from '@/types';

afterEach(() => closeAgentNeeded());
const health = (patch: Partial<Health>) => ({ ok: true, fake: false, keyReady: true, tosReady: true, todayYuan: 0, uncertainToday: 0, ...patch }) as Health;

// 11-15 用户定：拆解、写词、帮我改写只走本机 agent；没接好要弹框说明这一步是干嘛的。
it('说明框讲清这一步干嘛、花不花钱、缺什么、怎么办，是挡住页面的弹框', () => {
  const html = renderToStaticMarkup(<AgentNeededView problem="本机 Claude 没配好：装 Claude Code。" onClose={() => {}} />);
  expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
  for (const text of ['要先接好本机 AI 助手', '这一步干嘛', '花不花钱', '不花火山的钱', '现在缺什么', '本机 Claude 没配好：装 Claude Code。', '怎么办', '只出图、出视频用不到它', '>知道了<']) {
    expect(html).toContain(text);
  }
});

it('配好了或假模式不弹；没配好弹框带原话，关掉就清', () => {
  expect(askIfAgentMissing(health({ agentReady: true }))).toBe(false);
  expect(askIfAgentMissing(health({ fake: true, agentReady: false }))).toBe(false);
  expect(agentNeededProblem()).toBeNull();
  expect(askIfAgentMissing(health({ agentReady: false, agentProblem: '本机 Codex 没配好：在终端跑一次 codex login。' }))).toBe(true);
  expect(agentNeededProblem()).toBe('本机 Codex 没配好：在终端跑一次 codex login。');
  closeAgentNeeded(); expect(agentNeededProblem()).toBeNull();
  expect(askIfAgentMissing(health({ agentReady: false }))).toBe(true);
  expect(agentNeededProblem()).toBe('本机 Claude 或 Codex 没配好。');
});

it('点按钮时读一次体检：没配好返回 false 并弹框；体检读不到就放行（小服务会兜底拦）', async () => {
  expect(await agentReadyOrAsk(async () => health({ agentReady: true }))).toBe(true);
  expect(await agentReadyOrAsk(async () => health({ agentReady: false, agentProblem: '缺登录' }))).toBe(false);
  expect(agentNeededProblem()).toBe('缺登录'); closeAgentNeeded();
  expect(await agentReadyOrAsk(async () => { throw Error('连不上'); })).toBe(true);
  expect(agentNeededProblem()).toBeNull();
});
