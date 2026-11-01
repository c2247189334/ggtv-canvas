import { useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeLayer } from "./useEscapeLayer";
import { validAssetId } from "@/domain/videoPanel";

type Props = { value: string; onSave: (value: string) => void; onClose: () => void };

export function AssetIdDialog({ value, onSave, onClose }: Props) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEscapeLayer(onClose, true, 1250);
  return createPortal(
    <div className="confirm" role="dialog" aria-modal="true" aria-label="真人素材编号"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <form className="confirm__box" onSubmit={event => {
        event.preventDefault();
        if (!validAssetId(text)) { setError("素材编号只许 1～128 个英文字母、数字、点、下划线或短横线。"); return; }
        onSave(text);
      }}>
        <label>真人素材编号<input autoFocus aria-label="真人素材编号" value={text} onChange={event => setText(event.target.value)} /></label>
        <p>在火山方舟控制台「真人人像」里录入本人后，把素材编号复制到这里。填了以后，这张图给视频卡当参考时发编号、不发图片本身（火山不收真人照片）。</p>
        {error ? <p className="panel__error" role="alert">{error}</p> : null}
        <div className="confirm__actions"><button type="button" onClick={onClose}>取消</button><button type="submit" className="confirm__ok">保存</button></div>
      </form>
    </div>, document.body
  );
}
