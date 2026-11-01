import { useRef, useState } from "react";
import { PopMenu, type MenuItem } from "@/common/PopMenu";
import type { CanvasSummary } from "@/types";

type Props = {
  current: CanvasSummary;
  canvases: CanvasSummary[];
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
};

/** 左上「画布名 ▾」：切换、新建、改名（就地改，回车存、Esc 不改）、清空（10 秒内能撤销）、删除。 */
export function CanvasMenu({ current, canvases, onSwitch, onCreate, onRename, onDelete, onClear }: Props) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);

  if (editing) {
    return (
      <input
        className="canvas-menu canvas-menu--edit"
        autoFocus
        defaultValue={current.name}
        maxLength={40}
        onBlur={(event) => {
          if (!cancelled.current) onRename(current.id, event.currentTarget.value);
          cancelled.current = false;
          setEditing(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  const items: MenuItem[] = [
    ...canvases.map((c): MenuItem => ({ label: c.name, checked: c.id === current.id, onSelect: () => onSwitch(c.id) })),
    "divider",
    { label: "新建画布", onSelect: onCreate },
    { label: "改名", onSelect: () => setEditing(true) },
    { label: "清空这张画布", note: "10 秒内能撤销", onSelect: onClear },
    { label: "删除这张画布", onSelect: () => onDelete(current.id) }
  ];

  return (
    <>
      <button
        type="button"
        className="canvas-menu"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAt({ x: rect.left, y: rect.bottom + 6 });
        }}
      >
        {current.name} <span aria-hidden="true">▾</span>
      </button>
      {at ? <PopMenu at={at} items={items} onClose={() => setAt(null)} /> : null}
    </>
  );
}
