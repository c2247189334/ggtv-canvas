import { useRef, useState } from "react";
import { IMAGE_MODELS } from "@/domain/pricing";
import { normalizeGen } from "@/domain/normalizeGen";
import { FloatingPanel } from "./FloatingPanel";
import type { GenSettings } from "@/types";

type Props = { gen: GenSettings; onChange: (gen: GenSettings) => void };

export function ModelMenu({ gen, onChange, onClose }: Props & { onClose: () => void }) {
  return (
    <div role="menu" aria-label="出图模型">
      {IMAGE_MODELS.map((model) => (
        <button key={model.id} type="button" role="menuitemradio" aria-checked={gen.model === model.id}
          className="model-menu__item" onClick={() => {
            onChange(normalizeGen({ ...gen, model: model.id }));
            onClose();
          }}>
          <span className="model-icon" aria-hidden="true" />
          <span>{model.name}</span>
          <span className="model-menu__hint">{model.hint}</span>
        </button>
      ))}
    </div>
  );
}

/** 自绘方块图标；模型菜单复用 FloatingPanel 的外点和统一 Esc 关闭。 */
export function ModelPicker({ gen, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const model = IMAGE_MODELS.find((m) => m.id === gen.model) ?? IMAGE_MODELS[0];
  return (
    <>
      <button ref={button} type="button" className="gen__model" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <span className="model-icon" aria-hidden="true" />{model.name}
      </button>
      {open && button.current ? (
        <FloatingPanel anchor={button.current} direction="up" keepAnchor className="model-menu" onClose={() => setOpen(false)}>
          <ModelMenu gen={gen} onChange={onChange} onClose={() => setOpen(false)} />
        </FloatingPanel>
      ) : null}
    </>
  );
}
