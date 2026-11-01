import { useState, type MouseEvent } from "react";
import { useReactFlow, type Edge } from "@xyflow/react";
import type { MenuItem } from "@/common/PopMenu";
import { addMenuItems, assetMenuItems, contextMenuItems } from "@/domain/menus";
import { selectGraph } from "@/domain/selection";
import { suppressEdgeMenu } from "@/domain/edgeCut";
import { isEditable, cardAtPointer, type useBoardActions } from "@/canvas/useBoardActions";
import type { useCards } from "@/canvas/useCards";
import type { useBoardDoc } from "@/canvas/useBoardDoc";
import type { useGraphHistory } from "@/canvas/useGraphHistory";
import type { Point } from "@/domain/placement";
import type { CardNode } from "@/types";

type Menu = { x: number; y: number } & (
  { kind: "reference" | "downstream"; id: string } |
  { kind: "blank"; at: Point } |
  { kind: "context"; at: Point; card: boolean; id?: string }
);
export type PendingLink = { source: string; screen: Point; at: Point };
const NOT_BLANK = ".react-flow__node, .react-flow__edge, [data-edge-cut], .react-flow__panel, .react-flow__node-toolbar, .react-flow__attribution";

export function useBoardMenus(cards: ReturnType<typeof useCards>, doc: ReturnType<typeof useBoardDoc>, actions: ReturnType<typeof useBoardActions>, history: ReturnType<typeof useGraphHistory>, pending: PendingLink | null, closePending: () => void) {
  const flow = useReactFlow<CardNode, Edge>();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [assetDialog, setAssetDialog] = useState<{ id: string; value: string } | null>(null);
  const close = () => { setMenu(null); closePending(); };
  const atScreen = (event: MouseEvent) => ({ x: event.clientX, y: event.clientY });
  const openRefMenu = (id: string, anchor: DOMRect) => {
    closePending();
    setMenu({ x: anchor.left, y: anchor.bottom + 6, kind: "reference", id });
  };
  const openNextMenu = (id: string, anchor: DOMRect) => {
    closePending();
    setMenu({ x: anchor.right + 6, y: anchor.top, kind: "downstream", id });
  };
  const onDoubleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element) || !event.currentTarget.contains(target) || target.closest(NOT_BLANK)) return;
    const screen = atScreen(event);
    if (cardAtPointer(event.target, screen)) return;
    const at = flow.screenToFlowPosition(screen);
    closePending();
    setMenu({ ...screen, kind: "blank", at });
  };
  const onContextMenu = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (suppressEdgeMenu({ edge: Boolean(target?.closest(".react-flow__edge")), cutButton: Boolean(target?.closest("[data-edge-cut]")) })) {
      event.preventDefault();
      return;
    }
    if (isEditable(event.target)) return;
    event.preventDefault();
    const id = cardAtPointer(event.target, atScreen(event));
    if (id) {
      const selected = selectGraph({ nodes: flow.getNodes(), edges: flow.getEdges() }, id, "context");
      doc.setNodes(selected.nodes); doc.setEdges(selected.edges);
    }
    const screen = atScreen(event);
    const at = flow.screenToFlowPosition(screen);
    closePending();
    setMenu({ ...screen, kind: "context", at, card: Boolean(id), ...(id ? { id } : {}) });
  };
  // 只存菜单位置和类型，每次渲染接最新历史/内容，避免菜单操作旧快照。
  const itemsFor = (opened: Menu): MenuItem[] => {
    if (opened.kind === "context") return [...contextMenuItems(opened.card, {
      upload: () => void cards.uploadAt(opened.at), undo: history.undo, redo: history.redo,
      paste: () => actions.paste(opened.at), copy: actions.copy, duplicate: actions.duplicate, delete: actions.remove
    }, { undo: history.canUndo, redo: history.canRedo, paste: actions.canPaste }),
    ...assetMenuItems(opened.id ? flow.getNode(opened.id)?.data : undefined, () => {
      const data = opened.id ? flow.getNode(opened.id)?.data : undefined;
      if (data?.kind === "image" && opened.id) setAssetDialog({ id: opened.id, value: data.assetId ?? "" });
    }, () => { if (opened.id) cards.updateCard(opened.id, { assetId: undefined }); })];
    if (opened.kind === "blank") return addMenuItems("blank", {
      image: () => cards.addGenerateCard(opened.at), video: () => cards.addGenerateCard(opened.at, "video"),
      upload: () => void cards.uploadAt(opened.at), work: () => void cards.workAt(opened.at)
    });
    const id = opened.id;
    return addMenuItems(opened.kind, {
      image: () => opened.kind === "reference" ? cards.addUpstream(id) : cards.addDownstream(id),
      video: () => opened.kind === "reference" ? cards.addUpstream(id, "video") : cards.addDownstream(id, undefined, "video"),
      upload: () => void cards.addReference(id, "upload"), work: () => void cards.addReference(id, "work")
    }, flow.getNode(id)?.data.kind);
  };
  const active = pending ? {
    ...pending.screen, items: addMenuItems("downstream", {
      image: () => cards.addDownstream(pending.source, pending.at), video: () => cards.addDownstream(pending.source, pending.at, "video"), upload: () => {}, work: () => {}
    }, flow.getNode(pending.source)?.data.kind)
  } : menu ? { ...menu, items: itemsFor(menu) } : null;
  return { menu: active, close, onDoubleClick, onContextMenu, openRefMenu, openNextMenu, assetDialog,
    closeAssetDialog: () => setAssetDialog(null), saveAssetId: (value: string) => {
      if (assetDialog) cards.updateCard(assetDialog.id, { assetId: value });
      setAssetDialog(null);
    } };
}
