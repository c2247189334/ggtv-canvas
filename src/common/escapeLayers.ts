import { escapeAction, type EscapeLayer } from "@/domain/shortcuts";

type Layer = EscapeLayer & { close: () => void };
type Registry = { layers: Layer[]; onKey: (event: Event) => void };
const registries = new WeakMap<EventTarget, Registry>();
let nextId = 0;

/** 一个窗口仅一处捕获Esc；先消费事件再关闭，避免卸载后同一按键落到画布。 */
export function registerEscapeLayer(target: EventTarget, close: () => void, priority: number): () => void {
  let registry = registries.get(target);
  if (!registry) {
    const layers: Layer[] = [];
    const onKey = (event: Event) => {
      const action = escapeAction(event as KeyboardEvent, layers);
      if (action.type !== "close") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      layers.find(layer => layer.id === action.id)?.close();
    };
    registry = { layers, onKey };
    registries.set(target, registry);
    target.addEventListener("keydown", onKey, true);
  }
  const layer: Layer = { id: String(++nextId), priority, close };
  registry.layers.push(layer);
  return () => {
    const index = registry.layers.indexOf(layer);
    if (index < 0) return;
    registry.layers.splice(index, 1);
    if (!registry.layers.length) {
      target.removeEventListener("keydown", registry.onKey, true);
      registries.delete(target);
    }
  };
}
