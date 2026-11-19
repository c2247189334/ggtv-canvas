import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer } from './useEscapeLayer';
import { closeKeyNeeded, keyNeededOpen, openSettings, subscribeKeyNeeded } from './keyNeeded';

/** 没填火山 Key 时的说明框：这一步干嘛、花不花钱、缺什么、怎么办；「去填 Key」直接打开右上角设置。 */
export function KeyNeededView({ onFill, onClose }: { onFill: () => void; onClose: () => void }) {
  return <div className="confirm" role="dialog" aria-modal="true" aria-label="要先填火山 Key"
    onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="confirm__box agent-needed">
      <h2>要先填火山 Key</h2>
      <p><b>这一步干嘛：</b>出图、出视频是火山方舟算的，要用你自己的火山 Key（一串密码，证明是你的账号）。</p>
      <p><b>花不花钱：</b>按量计费，从你自己的火山账号扣，本工具不加价。</p>
      <p><b>现在缺什么：</b>还没填火山 Key，这单没发出去，没花钱。</p>
      <p><b>怎么办：</b>点「去填 Key」，在右上角设置里填好点保存，回来再点一次发送，不用重启。还没有 Key 的话，把鼠标移到设置里 Key 框旁边的「?」上，有步骤和网址。</p>
      <div className="confirm__actions">
        <button type="button" onClick={onClose}>先不填</button>
        <button type="button" className="confirm__go" onClick={onFill}>去填 Key</button>
      </div>
    </div>
  </div>;
}

function Open() {
  useEscapeLayer(closeKeyNeeded, true, 1250);
  return createPortal(<KeyNeededView onClose={closeKeyNeeded} onFill={() => { closeKeyNeeded(); openSettings(); }} />, document.body);
}

export function KeyNeededDialog() {
  const open = useSyncExternalStore(subscribeKeyNeeded, keyNeededOpen, keyNeededOpen);
  return open ? <Open /> : null;
}
