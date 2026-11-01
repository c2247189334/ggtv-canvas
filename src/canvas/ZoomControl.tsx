import { useState } from "react";
import { useReactFlow, useViewport } from "@xyflow/react";
import { PopMenu } from "@/common/PopMenu";
import { zoomPresets } from "@/domain/zoom";

/** 左下角缩放：显示当前百分比，点开 = 放大 / 缩小 / 适合屏幕 / 50% / 100% / 800%。 */
export function ZoomControl() {
  const flow = useReactFlow();
  const { zoom } = useViewport();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        type="button"
        className="zoom"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt({ x: rect.left, y: rect.top - 6 });
        }}
      >
        {Math.round(zoom * 100)}%
      </button>
      {at ? (
        <PopMenu
          above
          at={at}
          onClose={() => setAt(null)}
          items={[
            { label: "放大", onSelect: () => void flow.zoomIn() },
            { label: "缩小", onSelect: () => void flow.zoomOut() },
            { label: "适合屏幕", onSelect: () => void flow.fitView({ padding: 0.2, maxZoom: 1 }) },
            ...zoomPresets.map(preset => ({ label: preset.label, onSelect: () => void flow.zoomTo(preset.zoom) }))
          ]}
        />
      ) : null}
    </>
  );
}
