import { Panel } from "@xyflow/react";

type Props = {
  onReturn: () => void;
  onExit: () => void;
  onCancel: () => void;
  label: { x: number; y: number; text: string; cancel: boolean } | null;
};

export function RefPickBar({ onReturn, onExit, label, onCancel }: Props) {
  return <>
    <Panel position="top-center" className="ref-pick-bar">
      <span>从画布选择参考</span>
      <button type="button" onClick={onReturn}>返回节点</button>
      <button type="button" onClick={onExit}>退出</button>
    </Panel>
    {label ? <div className={`ref-pick-label${label.cancel ? " is-cancel" : ""}`} style={{ left: label.x, top: label.y }}>
      {label.cancel ? <button type="button" onClick={onCancel}>取消选择</button> : <span>{label.text}</span>}
    </div> : null}
  </>;
}
