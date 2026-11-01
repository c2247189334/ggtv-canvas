import { useRef, useState } from "react";
import { ASPECT_OPTIONS, SIZE_FROM_ASPECT, sizeSourceOf } from "@/domain/aspects";
import { IMAGE_MODELS, estimateYuan, formatYuan } from "@/domain/pricing";
import { FloatingPanel } from "./FloatingPanel";
import { ModelPicker } from "./ModelPicker";
import type { GenSettings } from "@/types";

type Props = { gen: GenSettings; refCount: number; sending: boolean; onChange: (gen: GenSettings) => void; onSend: () => void };

/** 提示词面板底行：模型 · 比例/分辨率/张数 · 估价 · 发送。发送中锁住发送按钮。 */
export function GenOptions({ gen, refCount, sending, onChange, onSend }: Props) {
  const source = sizeSourceOf(gen.sizeFrom, refCount);
  const sizeLabel = "aspect" in source ? gen.aspect : `跟图片${source.ref}`;
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <div className="gen">
      <ModelPicker gen={gen} onChange={onChange} />
      <button ref={button} type="button" className="gen__settings" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>{`${sizeLabel} · ${gen.resolution} · ${gen.count}张`}</button>
      {open && button.current ? (
        <FloatingPanel anchor={button.current} keepAnchor onClose={() => setOpen(false)} className="gen-options">
          <GenOptionChoices gen={gen} refCount={refCount} onChange={onChange} />
        </FloatingPanel>
      ) : null}
      <span className="gen__price" title="火山按张收钱，参考图不收钱">{formatYuan(estimateYuan(gen.model, gen.count))}</span>
      <button type="button" className="gen__send" disabled={sending} onClick={onSend}>
        {sending ? "发送中…" : "发送"}
      </button>
    </div>
  );
}

export function GenOptionChoices({ gen, refCount, onChange }: Pick<Props, "gen" | "refCount" | "onChange">) {
  const source = sizeSourceOf(gen.sizeFrom, refCount);
  const model = IMAGE_MODELS.find((m) => m.id === gen.model) ?? IMAGE_MODELS[0];
  return (
    <>
      <h3>分辨率</h3>
      <div className="gen-options__choices">
        {model.resolutions.map((resolution) => (
          <button key={resolution} type="button" aria-pressed={gen.resolution === resolution}
            onClick={() => onChange({ ...gen, resolution })}>{resolution}</button>
        ))}
      </div>
      <h3>比例</h3>
      <div className="gen-options__choices">
        {Array.from({ length: refCount }, (_, i) => (
          <button key={`ref${i}`} type="button" aria-pressed={"ref" in source && source.ref === i + 1}
            onClick={() => onChange({ ...gen, sizeFrom: i + 1 })}>跟图片{i + 1}</button>
        ))}
        {ASPECT_OPTIONS.filter((aspect) => model.aspects.includes(aspect.id)).map((aspect) => (
          <button key={aspect.id} type="button" aria-pressed={"aspect" in source && gen.aspect === aspect.id}
            onClick={() => onChange({ ...gen, sizeFrom: SIZE_FROM_ASPECT, aspect: aspect.id })}>{aspect.label}</button>
        ))}
      </div>
      <h3>生成数量</h3>
      <div className="gen-options__choices">
        {[1, 2, 4].map((count) => (
          <button key={count} type="button" aria-pressed={gen.count === count}
            onClick={() => onChange({ ...gen, count })}>{count}张</button>
        ))}
      </div>
    </>
  );
}
