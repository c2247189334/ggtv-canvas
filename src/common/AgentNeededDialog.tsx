import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from './useEscapeLayer';
import { agentNeededProblem, closeAgentNeeded, subscribeAgentNeeded } from './agentNeeded';

/** 本机 agent 没配好时的说明框：这一步干嘛、花不花钱、缺什么、怎么办。 */
export function AgentNeededView({ problem, onClose }: { problem: string; onClose: () => void }) {
  return <div className="confirm" role="dialog" aria-modal="true" aria-label="要先接好本机 AI 助手"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="confirm__box agent-needed">
      <h2>要先接好本机 AI 助手</h2>
      <p><b>这一步干嘛：</b>让你电脑上的 Claude 或 Codex 看视频和图片，帮你拆解、写提示词、改写。</p>
      <p><b>花不花钱：</b>不花火山的钱，用的是你自己 Claude / Codex 账号的额度。</p>
      <p><b>现在缺什么：</b>{problem}</p>
      <p><b>怎么办：</b>装 Claude 桌面版或 Claude Code（或 Codex），用你自己的账号登录一次，回来再点一下；刚装的要是还提示找不到，关掉黑窗口、重新双击「一键启动.bat」。详细步骤见安装说明里的「接本机 AI 助手」。只出图、出视频用不到它。</p>
      <div className="confirm__actions"><button type="button" onClick={onClose}>知道了</button></div>
    </div>
  </div>;
}

function Open({ problem }: { problem: string }) {
  useEscapeLayer(closeAgentNeeded, true, 1250);
  return createPortal(<AgentNeededView problem={problem} onClose={closeAgentNeeded} />, document.body);
}

export function AgentNeededDialog() {
  const problem = useSyncExternalStore(subscribeAgentNeeded, agentNeededProblem, agentNeededProblem);
  return problem ? <Open problem={problem} /> : null;
}
